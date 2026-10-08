/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";
import { fetchUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { FluxDispatcher, UserProfileStore } from "@webpack/common";

import { hasCachedBadges, setCachedBadges } from "./badgeCache";

const COOLDOWN_KEY = "BadgesPlus:cooldownUntil:v1";

// Fila de busca de perfis, usada pelas badges ao lado do nome e pelo pesquisador.
// Profile fetch queue, shared by the name badges and the badge search.
//
// Roda vários fetches em paralelo (concorrência das configurações) para ir bem mais rápido,
// mas com freio adaptativo: se o Discord responder 429, pausa todo mundo pelo tempo pedido,
// aumenta o intervalo e volta a acelerar depois de uma sequência de sucessos.
// Runs several fetches in parallel (concurrency from settings) to go much faster, with an
// adaptive brake: on a 429 it pauses everyone for the requested time, grows the interval and
// speeds up again after a streak of successes.

const logger = new Logger("BadgesPlus");

const MAX_DELAY = 6000;
const MAX_CONCURRENCY = 8;
const SPEEDUP_AFTER = 8;

const queue: string[] = [];
const queued = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

let minDelay = 500;
let maxConcurrency = 2;
let delay = minDelay;
let streak = 0;
let running = false;
let pausedUntil = 0;
let okCount = 0;
let failCount = 0;
let consecutive429 = 0;

// Se o Discord mandar 429, cada vez espaçamos mais (10s, 20s, 40s... até 5min). Insistir a cada
// poucos segundos, quando a conta está em limite GLOBAL, só mantém o limite vivo — e aí NADA carrega.
// On a 429 we space it out more each time (10s, 20s, 40s... up to 5min). Retrying every few seconds
// while the account is in a GLOBAL limit only keeps the limit alive — and then NOTHING loads.
const MAX_BACKOFF = 300000;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const notify = () => listeners.forEach(l => l());

export function setMinDelay(ms: number) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return;
    minDelay = value;
    delay = Math.max(delay, value);
}

export function setConcurrency(n: number) {
    const value = Math.round(Number(n));
    if (!Number.isFinite(value)) return;
    maxConcurrency = Math.max(1, Math.min(MAX_CONCURRENCY, value));
}

/**
 * Lê o cooldown salvo no disco. Sem isso, toda vez que o app reinicia ele já volta martelando o
 * Discord e o limite nunca libera. / Reads the cooldown saved on disk. Without it, every app restart
 * immediately hammers Discord again and the limit never clears.
 */
export async function initCooldown() {
    try {
        const until = await DataStore.get<number>(COOLDOWN_KEY);
        if (typeof until === "number" && until > Date.now()) {
            pausedUntil = Math.max(pausedUntil, until);
            logger.warn(`Conta ainda em cooldown até ${new Date(until).toLocaleTimeString()} / account still cooling down until then`);
        }
    } catch { /* ignore */ }
}

function setCooldown(until: number) {
    pausedUntil = Math.max(pausedUntil, until);
    void DataStore.set(COOLDOWN_KEY, until).catch(() => { });
}

/** Perfil já carregado, já veio do cache, ou falhou / profile already loaded, already cached, or failed */
export const isDone = (id: string) =>
    failed.has(id) || hasCachedBadges(id) || !!UserProfileStore.getUserProfile(id);

export const pendingCount = () => queue.length;

/** Estatísticas pra interface / stats for the UI */
export function getQueueStats() {
    return {
        pending: queue.length,
        ok: okCount,
        failed: failCount,
        pausedMs: Math.max(0, pausedUntil - Date.now())
    };
}

export function onQueueChange(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
}

/**
 * Coloca perfis na fila / Queues profiles.
 * @param front true = passa na frente (quem está na tela) / jumps the queue (who is on screen)
 */
export function queueProfiles(ids: string[], front = false) {
    for (const id of ids) {
        if (isDone(id)) continue;
        if (queued.has(id)) {
            if (!front) continue;
            queue.splice(queue.indexOf(id), 1);
        }
        queued.add(id);
        front ? queue.unshift(id) : queue.push(id);
    }

    notify();
    if (!running) pump();
}

export function clearQueue() {
    queue.length = 0;
    queued.clear();
    notify();
}

function pump() {
    if (running || !queue.length) {
        running = false;
        notify();
        return;
    }

    running = true;
    let finished = 0;
    const total = Math.max(1, maxConcurrency);

    for (let i = 0; i < total; i++) {
        void worker().finally(() => {
            if (++finished < total) return;
            running = false;
            // itens podem ter entrado enquanto os workers terminavam / items may have been
            // queued while the workers were finishing
            if (queue.length) pump();
            else notify();
        });
    }
}

async function worker() {
    while (queue.length) {
        const id = queue.shift()!;
        queued.delete(id);
        if (isDone(id)) continue;

        const wait = pausedUntil - Date.now();
        if (wait > 0) await sleep(wait);

        try {
            await fetchUserProfile(id);
            // guarda no cache persistente pra não recomeçar do topo depois
            // store in the persistent cache so it doesn't start over from the top later
            const badges = UserProfileStore.getUserProfile(id)?.badges;
            if (badges) setCachedBadges(id, badges);
            okCount++;
            consecutive429 = 0;
            if (++streak >= SPEEDUP_AFTER) {
                streak = 0;
                delay = Math.max(minDelay, Math.round(delay * 0.8));
            }
        } catch (e: any) {
            // evita o Discord achar que ainda está carregando / so Discord doesn't think it's still loading
            FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_FAILURE", userId: id });
            streak = 0;

            if (e?.status === 429) {
                // Backoff exponencial, com piso no retry_after que o Discord mandar.
                // Exponential backoff, floored by Discord's retry_after.
                consecutive429++;
                const expMs = Math.min(MAX_BACKOFF, 10000 * 2 ** Math.min(consecutive429 - 1, 5));
                const retryMs = (Number(e?.body?.retry_after) || 0) * 1000;
                const waitMs = Math.max(expMs, retryMs);

                delay = Math.min(MAX_DELAY, Math.round(delay * 1.25) + 150);
                setCooldown(Date.now() + waitMs);
                logger.warn(`Rate limited: esperando ${Math.round(waitMs / 1000)}s (429 seguidos: ${consecutive429})`);

                // devolve pro FIM da fila: não ficar churnando as mesmas contas na frente
                // back of the line: don't keep churning the same accounts at the front
                queued.add(id);
                queue.push(id);
                notify();
                await sleep(waitMs);
                continue;
            }

            failCount++;
            failed.add(id);
        }

        notify();
        // jitter evita que todos os workers batam no mesmo instante / jitter keeps the workers
        // from hitting Discord at the exact same time
        await sleep(delay + Math.random() * 120);
    }
}
