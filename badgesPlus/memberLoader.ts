/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, GuildMemberCountStore, GuildMemberStore } from "@webpack/common";

const logger = new Logger("BadgesPlus");

// Módulo de ações de membro do gateway (o mesmo que a lista de membros do Discord usa).
// Gateway member action module (the same one Discord's member list uses).
const GuildActions = findByPropsLazy("requestMembers", "requestMembersById") as {
    requestMembers?: (guildId: string, query?: string, limit?: number, includePresences?: boolean) => void;
} | undefined;

// Caracteres usados para "fatiar" a busca, igual à busca da lista de membros do Discord.
// Characters used to "slice" the search, like Discord's own member list search.
const CHARS = "abcdefghijklmnopqrstuvwxyz0123456789._-";
const PAGE = 100;
const MAX_DEPTH = 3;
const REQUEST_BUDGET = 12000; // teto de segurança / safety cap
const CONCURRENCY = 4; // requisições em voo ao mesmo tempo / requests in flight at once
const SETTLE_MS = 800; // tempo esperando os chunks de cada consulta / wait per query
const ALL_IDLE_MS = 1500; // janela ociosa da requisição "todos os membros"
const ALL_TIMEOUT_MS = 45000; // teto da requisição "todos os membros"

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export interface MemberScanProgress {
    loaded: number;
    total: number;
    done: boolean;
    cancelled: boolean;
}

export interface MemberScanController {
    cancelled: boolean;
    cancel(): void;
}

const activeScans = new Set<MemberScanController>();

export function cancelAllMemberScans() {
    for (const scan of activeScans) scan.cancel();
}

export function loadedMemberCount(guildId: string) {
    return GuildMemberStore.getMemberIds(guildId).length;
}

interface Probe {
    query: string;
    hits: number;
    lastAt: number;
}

/**
 * Puxa o máximo de membros possível direto do gateway. As requisições vão pro gateway (op 8),
 * não pra REST, então NÃO consomem o limite de perfil (que é o que as badges de Nitro usam) —
 * dá pra carregar membros e perfis em paralelo sem brigar pelo mesmo bucket.
 * Pulls as many members as possible straight from the gateway. Requests go to the gateway (op 8),
 * not REST, so they do NOT use the profile limit (the one the Nitro badges use) — members and
 * profiles can load side by side without fighting for the same bucket.
 *
 * Estratégia / strategy:
 *  1. Pede "todos os membros" de uma vez (query vazia). O Discord manda em chunks.
 *  2. Se ainda faltar gente, fatia por prefixo (a, b, ..., aa, ab, ...) em paralelo, aprofundando
 *     só quando uma página volta cheia (100), que é o sinal de que ainda tem gente naquele prefixo.
 */
export function scanGuildMembers(
    guildId: string,
    onProgress: (progress: MemberScanProgress) => void,
    gap = 300
): MemberScanController {
    const controller: MemberScanController = {
        cancelled: false,
        cancel() { controller.cancelled = true; }
    };
    activeScans.add(controller);

    const total = (() => {
        try { return GuildMemberCountStore?.getMemberCount(guildId) ?? 0; } catch { return 0; }
    })();

    const probes = new Map<string, Probe>();
    let loaded = loadedMemberCount(guildId);
    let lastEmit = 0;
    let lastActivity = Date.now();

    const emit = (done: boolean) => {
        const now = Date.now();
        if (!done && now - lastEmit < 200) return;
        lastEmit = now;
        onProgress({ loaded, total, done, cancelled: controller.cancelled });
    };

    const refresh = () => {
        const next = loadedMemberCount(guildId);
        if (next > loaded) loaded = next;
    };

    const dispatchProbe = (query: string) => {
        const nonce = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
        probes.set(nonce, { query, hits: 0, lastAt: Date.now() });
        try {
            FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST",
                guildId,
                guildIds: [guildId],
                query,
                limit: query ? PAGE : 0,
                presences: false,
                includePresences: false,
                nonce
            });
        } catch (e) {
            probes.delete(nonce);
            logger.error("Falha ao pedir membros / Failed to request members", e);
        }
    };

    const requestAll = () => {
        lastActivity = Date.now();
        try {
            // A busca vazia (todos os membros) precisa da ação nativa do cliente.
            // The empty query (all members) needs the client's native action.
            if (GuildActions?.requestMembers) {
                GuildActions.requestMembers(guildId, "", 0, false);
                return;
            }
        } catch (e) {
            logger.error("Falha no pedido 'todos os membros' / Failed the all-members request", e);
        }
        // fallback: dispara pelo fluxo / fall back to flux
        dispatchProbe("");
    };

    const onChunk = (e: any) => {
        const gid = e?.guildId ?? e?.guild_id ?? e?.guildID;
        if (gid && gid !== guildId) return;

        lastActivity = Date.now();

        const nonce = e?.nonce;
        const hits = Array.isArray(e?.members)
            ? e.members.length
            : Array.isArray(e?.memberIds) ? e.memberIds.length : 0;
        const probe = nonce != null ? probes.get(nonce) : undefined;
        if (probe) {
            probe.hits += hits;
            probe.lastAt = Date.now();
        }

        refresh();
        emit(false);
    };

    const onBatch = (e: any) => {
        const chunks = Array.isArray(e?.chunks) ? e.chunks : [];
        for (const chunk of chunks) onChunk(chunk);
    };

    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", onChunk);
    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK_BATCH", onBatch);

    void (async () => {
        try {
            // 1) todos os membros de uma vez / all members in one go
            if (!controller.cancelled) {
                requestAll();
                const started = Date.now();
                while (!controller.cancelled && Date.now() - started < ALL_TIMEOUT_MS) {
                    await sleep(250);
                    refresh();
                    emit(false);
                    if (total && loaded >= total) break;
                    if (Date.now() - lastActivity >= ALL_IDLE_MS) break;
                }
            }

            // 2) fatia por prefixo em paralelo / parallel prefix fan-out
            const queue: string[] = CHARS.split("");
            const seen = new Set(queue);
            let budget = REQUEST_BUDGET;

            while (!controller.cancelled && budget > 0 && (queue.length || probes.size)) {
                if (total && loaded >= total) break;

                // mantém CONCURRENCY consultas em voo / keep CONCURRENCY queries in flight
                while (probes.size < CONCURRENCY && queue.length && budget-- > 0 && !controller.cancelled) {
                    dispatchProbe(queue.shift()!);
                    await sleep(Math.max(50, Math.round(gap / CONCURRENCY)));
                }

                await sleep(120);

                const now = Date.now();
                for (const [nonce, probe] of [...probes]) {
                    if (now - probe.lastAt < SETTLE_MS) continue;
                    probes.delete(nonce);
                    // página cheia = ainda tem gente nesse prefixo; desce um nível
                    // full page = there are still people with that prefix; go deeper
                    if (probe.query && probe.hits >= PAGE && probe.query.length < MAX_DEPTH) {
                        for (const char of CHARS) {
                            const next = probe.query + char;
                            if (!seen.has(next)) {
                                seen.add(next);
                                queue.push(next);
                            }
                        }
                    }
                }

                refresh();
                emit(false);
            }

            // deixa os últimos chunks chegarem / let the last chunks land
            await sleep(SETTLE_MS);
            refresh();
            emit(true);
        } finally {
            FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", onChunk);
            FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK_BATCH", onBatch);
            activeScans.delete(controller);
        }
    })();

    return controller;
}
