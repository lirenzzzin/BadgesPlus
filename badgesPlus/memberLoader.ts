/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, GuildMemberCountStore, GuildMemberStore, SnowflakeUtils } from "@webpack/common";

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
const MAX_DEPTH = 2;
const REQUEST_BUDGET = 400;
const SETTLE_MS = 350;
const IDLE_MS = 1200;

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

/**
 * Puxa o máximo de membros possível direto do gateway. As requisições vão pro gateway (op 8),
 * não pra REST, então não consomem o limite do endpoint de perfil usado pelas badges de Nitro
 * e impulso — dá pra carregar membros em paralelo com os perfis sem brigar pelo mesmo bucket.
 * Pulls as many members as possible straight from the gateway. Requests go to the gateway
 * (op 8), not REST, so they don't use the profile endpoint limit used by the Nitro and boost
 * badges — members and profiles can load side by side without fighting for the same bucket.
 *
 * @param gap intervalo entre requisições / delay between requests, in ms
 */
export function scanGuildMembers(
    guildId: string,
    onProgress: (progress: MemberScanProgress) => void,
    gap = 400
): MemberScanController {
    const controller: MemberScanController = {
        cancelled: false,
        cancel() { controller.cancelled = true; }
    };
    activeScans.add(controller);

    const total = (() => {
        try { return GuildMemberCountStore?.getMemberCount(guildId) ?? 0; } catch { return 0; }
    })();

    // cada resposta chega com um nonce; guardamos quantos membros cada uma trouxe
    // every reply comes with a nonce; we track how many members each one brought back
    const probes = new Map<string, number>();
    let loaded = loadedMemberCount(guildId);
    let lastEmit = 0;

    const emit = (done: boolean) => {
        const now = Date.now();
        // não dispara um render por chunk; no máximo ~5 por segundo / don't fire a render per
        // chunk; at most ~5 per second
        if (!done && now - lastEmit < 200) return;
        lastEmit = now;
        onProgress({ loaded, total, done, cancelled: controller.cancelled });
    };

    const refresh = () => {
        const next = loadedMemberCount(guildId);
        if (next > loaded) loaded = next;
    };

    const request = (query: string) => {
        const limit = query ? PAGE : 0;
        const nonce = SnowflakeUtils.fromTimestamp(Date.now());
        probes.set(nonce, 0);

        try {
            // A busca vazia (todos os membros) funciona melhor pela ação nativa.
            // The empty query (all members) works best through the native action.
            if (!query && GuildActions?.requestMembers) {
                GuildActions.requestMembers(guildId, "", limit, false);
                return null;
            }

            FluxDispatcher.dispatch({
                type: "GUILD_MEMBERS_REQUEST",
                guildId,
                guildIds: [guildId],
                query,
                limit,
                presences: false,
                includePresences: false,
                nonce
            });
            return nonce;
        } catch (e) {
            probes.delete(nonce);
            logger.error("Falha ao pedir membros / Failed to request members", e);
            return null;
        }
    };

    const onChunk = (e: any) => {
        const gid = e?.guildId ?? e?.guild_id ?? e?.guildID;
        if (gid && gid !== guildId) return;

        const nonce = e?.nonce;
        const hits = Array.isArray(e?.members)
            ? e.members.length
            : Array.isArray(e?.memberIds) ? e.memberIds.length : 0;
        if (nonce != null && probes.has(nonce)) probes.set(nonce, (probes.get(nonce) ?? 0) + hits);

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
            const queue: string[] = ["", ...CHARS.split("")];
            const seen = new Set(queue);
            let budget = REQUEST_BUDGET;

            while (queue.length && budget-- > 0 && !controller.cancelled) {
                if (total && loaded >= total) break;

                const query = queue.shift()!;
                const nonce = request(query);

                await sleep(Math.max(gap, SETTLE_MS));
                refresh();

                // página cheia = ainda tem gente com esse prefixo; desce mais um nível
                // full page = there are still people with that prefix; go one level deeper
                if (query && nonce && (probes.get(nonce) ?? 0) >= PAGE && query.length < MAX_DEPTH) {
                    for (const char of CHARS) {
                        const next = query + char;
                        if (!seen.has(next)) {
                            seen.add(next);
                            queue.push(next);
                        }
                    }
                }
            }

            // deixa as últimas respostas chegarem / let the last replies land
            await sleep(IDLE_MS);
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
