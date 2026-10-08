/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { Logger } from "@utils/Logger";
import { FluxDispatcher, GuildMemberCountStore, GuildMemberStore } from "@webpack/common";

const logger = new Logger("BadgesPlus");

const MEMBERS_SELECTOR = 'div[class*="members_"]';
const MAX_MS = 20 * 60 * 1000; // teto de tempo por varredura / per-scan time cap
const ZERO_GROWTH_PASSES = 3; // voltas sem gente nova antes de parar / empty passes before stopping

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

// A lista de membros do Discord carrega em FAIXAS conforme você rola (é o mesmo mecanismo do
// cliente, então não passa pelo rate limit da API). A busca do gateway (op 8) saturava e ainda
// ajudava a tomar limite — por isso a varredura agora é só a rolagem.
// Discord's member list loads in RANGES as you scroll (the client's own mechanism, so it doesn't go
// through the API rate limit). The gateway search (op 8) saturated and even helped hit the limit —
// so the scan is now scroll-only.

function getMemberListEl(): HTMLElement | null {
    const el = document.querySelector(MEMBERS_SELECTOR);
    return el instanceof HTMLElement && el.scrollHeight > el.clientHeight ? el : null;
}

function ensureMemberListOpen() {
    if (getMemberListEl()) return;
    const btn = document.querySelector(
        '[aria-label="Show Member List"], [aria-label="Mostrar lista de membros"], [aria-label*="Member List"], [aria-label*="lista de membros"]'
    );
    if (btn instanceof HTMLElement) btn.click();
}

/**
 * Carrega o máximo de membros varrendo a lista de membros de cima a baixo. Para sozinho quando uma
 * volta inteira não traz gente nova, e o botão Parar interrompe na hora.
 * Loads as many members as possible by sweeping the member list top to bottom. It stops on its own
 * when a full pass brings nobody new, and the Stop button halts it immediately.
 */
export function scanGuildMembers(
    guildId: string,
    onProgress: (progress: MemberScanProgress) => void
): MemberScanController {
    const controller: MemberScanController = {
        cancelled: false,
        cancel() { controller.cancelled = true; }
    };
    activeScans.add(controller);

    const total = (() => {
        try { return GuildMemberCountStore?.getMemberCount(guildId) ?? 0; } catch { return 0; }
    })();

    let loaded = loadedMemberCount(guildId);
    let lastEmit = 0;

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

    const onChunk = () => { refresh(); emit(false); };
    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK", onChunk);
    FluxDispatcher.subscribe("GUILD_MEMBERS_CHUNK_BATCH", onChunk);

    void (async () => {
        const startedAt = Date.now();
        let pos = 0;
        let emptyPasses = 0;
        let lastCount = loaded;

        try {
            ensureMemberListOpen();
            await sleep(700);

            while (!controller.cancelled && Date.now() - startedAt < MAX_MS) {
                if (total && loaded >= total) break;

                const el = getMemberListEl();
                if (!el) {
                    ensureMemberListOpen();
                    await sleep(500);
                    refresh();
                    emit(false);
                    continue;
                }

                const max = el.scrollHeight - el.clientHeight;
                el.scrollTop = Math.min(pos, max);
                await sleep(320);
                refresh();
                emit(false);

                pos += Math.max(120, Math.floor(el.clientHeight * 0.75));

                if (pos > max) {
                    // deu a volta: a lista chegou no fim / reached the end, looping back
                    pos = 0;
                    const grew = loaded - lastCount;
                    lastCount = loaded;
                    if (grew < 3) {
                        if (++emptyPasses >= ZERO_GROWTH_PASSES) break;
                    } else {
                        emptyPasses = 0;
                    }
                }
            }

            logger.info(`Varredura de membros: ${loaded}/${total}`);
            emit(true);
        } finally {
            FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK", onChunk);
            FluxDispatcher.unsubscribe("GUILD_MEMBERS_CHUNK_BATCH", onChunk);
            activeScans.delete(controller);
        }
    })();

    return controller;
}
