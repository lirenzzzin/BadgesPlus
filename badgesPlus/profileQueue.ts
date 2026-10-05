/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { fetchUserProfile } from "@utils/discord";
import { Logger } from "@utils/Logger";
import { FluxDispatcher, UserProfileStore } from "@webpack/common";

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

const MAX_DELAY = 8000;
const MAX_CONCURRENCY = 6;
const SPEEDUP_AFTER = 8;

const queue: string[] = [];
const queued = new Set<string>();
const failed = new Set<string>();
const listeners = new Set<() => void>();

let minDelay = 500;
let maxConcurrency = 3;
let delay = minDelay;
let streak = 0;
let running = false;
let pausedUntil = 0;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const notify = () => listeners.forEach(l => l());

export function setMinDelay(ms: number) {
    minDelay = ms;
    delay = Math.max(delay, ms);
}

export function setConcurrency(n: number) {
    maxConcurrency = Math.max(1, Math.min(MAX_CONCURRENCY, Math.round(n)));
}

/** Perfil já carregado ou falhou (ex.: conta apagada) / Profile already loaded or failed (e.g. deleted account) */
export const isDone = (id: string) => failed.has(id) || !!UserProfileStore.getUserProfile(id);

export const pendingCount = () => queue.length;

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
    const total = maxConcurrency;

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
            if (++streak >= SPEEDUP_AFTER) {
                streak = 0;
                delay = Math.max(minDelay, Math.round(delay * 0.8));
            }
        } catch (e: any) {
            // evita o Discord achar que ainda está carregando / so Discord doesn't think it's still loading
            FluxDispatcher.dispatch({ type: "USER_PROFILE_FETCH_FAILURE", userId: id });
            streak = 0;

            if (e?.status === 429) {
                const retryAfter = Number(e?.body?.retry_after) || 5;
                delay = Math.min(MAX_DELAY, Math.round(delay * 1.5) + 250);
                pausedUntil = Date.now() + retryAfter * 1000;
                logger.warn(`Rate limited: pausing ${retryAfter}s, new interval ${delay}ms`);
                queued.add(id);
                queue.unshift(id);
                notify();
                await sleep(retryAfter * 1000);
                continue;
            }

            failed.add(id);
        }

        notify();
        // jitter evita que todos os workers batam no mesmo instante / jitter keeps the workers
        // from hitting Discord at the exact same time
        await sleep(delay + Math.random() * 120);
    }
}
