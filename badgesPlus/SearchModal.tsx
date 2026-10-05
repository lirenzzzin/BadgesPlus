/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { openUserProfile } from "@utils/discord";
import { classes } from "@utils/misc";
import { RenderModalProps, User } from "@vencord/discord-types";
import {
    ChannelActionCreators, GuildMemberCountStore, GuildMemberStore, GuildStore, Modal, openModal, Tooltip,
    useEffect, useMemo, UserProfileStore, UserStore, useState
} from "@webpack/common";

import { badgeIconUrl, badgeSortRank, getBadgeLabel, getCategory, getFlagBadges, getTooltip, isCategoryEnabled, SimpleBadge } from "./badges";
import { plural, t } from "./i18n";
import { cancelAllMemberScans, MemberScanProgress, scanGuildMembers } from "./memberLoader";
import { clearQueue, isDone, onQueueChange, pendingCount, queueProfiles } from "./profileQueue";
import { settings } from "./settings";

interface MemberEntry {
    user: User;
    name: string;
    badges: SimpleBadge[];
    done: boolean;
}

/** Recalcula quando perfis, membros ou a fila mudam / Recomputes when profiles, members or the queue change */
function useGuildMembers(guildId: string, includeBots: boolean) {
    const [tick, setTick] = useState(0);

    useEffect(() => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        // throttle (não debounce!): agenda um recálculo, mas não empurra ele pra frente pra sempre.
        // Com debounce, durante o carregamento contínuo o timer reiniciava a cada perfil e nunca
        // disparava — a lista congelava e o carregamento parava. / throttle (not debounce!): schedule
        // a recompute but don't keep pushing it back. With debounce, during continuous loading the
        // timer reset on every profile and never fired — the list froze and loading stopped.
        const onChange = () => {
            if (timer != null) return;
            timer = setTimeout(() => {
                timer = undefined;
                setTick(n => n + 1);
            }, 400);
        };
        UserProfileStore.addChangeListener(onChange);
        GuildMemberStore.addChangeListener(onChange);
        const unsubscribe = onQueueChange(onChange);
        return () => {
            clearTimeout(timer);
            UserProfileStore.removeChangeListener(onChange);
            GuildMemberStore.removeChangeListener(onChange);
            unsubscribe();
        };
    }, []);

    return useMemo(() => {
        const entries: MemberEntry[] = [];
        for (const id of GuildMemberStore.getMemberIds(guildId)) {
            const user = UserStore.getUser(id);
            if (!user || (user.bot && !includeBots)) continue;

            const profile = UserProfileStore.getUserProfile(id);
            entries.push({
                user,
                name: GuildMemberStore.getNick(guildId, id) ?? (user as any).globalName ?? user.username,
                badges: (profile?.badges as SimpleBadge[] | undefined) ?? getFlagBadges(user),
                done: isDone(id)
            });
        }
        return entries;
    }, [guildId, includeBots, tick]);
}

function BadgeIcon({ badge, size, dim }: { badge: SimpleBadge; size: number; dim?: boolean; }) {
    return (
        <Tooltip text={getTooltip(badge)}>
            {props => (
                <img
                    {...props}
                    className="vc-badgesplus-search-icon"
                    style={{ opacity: dim ? 0.35 : 1 }}
                    src={badgeIconUrl(badge.icon)}
                    width={size}
                    height={size}
                    alt={getBadgeLabel(badge)}
                    draggable={false}
                />
            )}
        </Tooltip>
    );
}

function MessageIcon() {
    return (
        <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 2.8C6.7 2.8 2.5 6.5 2.5 11.1c0 2.4 1.2 4.6 3.1 6.1-.2 1.4-.8 2.7-1.8 3.7-.2.2-.1.6.2.6 2.2 0 4-.8 5.3-1.8.9.2 1.8.3 2.7.3 5.3 0 9.5-3.7 9.5-8.3S17.3 2.8 12 2.8Z" />
        </svg>
    );
}

function SearchBadgesModal({ guildId, modalProps }: { guildId: string; modalProps: RenderModalProps; }) {
    const s = settings.use();
    const [selected, setSelected] = useState<string[]>([]);

    const members = useGuildMembers(guildId, s.searchIncludeBots);
    const guild = GuildStore.getGuild(guildId);
    const memberCount = GuildMemberCountStore.getMemberCount(guildId);
    const myId = UserStore.getCurrentUser()?.id;
    const pending = pendingCount();
    // total já carregado, sem o filtro de bots / total already loaded, without the bot filter
    const rawLoaded = GuildMemberStore.getMemberIds(guildId).length;
    const [scan, setScan] = useState<MemberScanProgress | null>(null);

    // ---- filtros do pesquisador / search filters ----
    const [usernameQuery, setUsernameQuery] = useState("");
    const [lenInput, setLenInput] = useState("");
    const [badgeQuery, setBadgeQuery] = useState("");

    const lengthFilter = useMemo(() => {
        const n = parseInt(lenInput, 10);
        return Number.isFinite(n) && n > 0 && n <= 32 ? n : null;
    }, [lenInput]);

    // Por padrão mostra TUDO (igual antes). O filtro por categoria só entra se você ligar
    // "Pesquisar só as categorias ligadas"; o "esconder quest" também é opcional.
    // By default it shows EVERYTHING (like before). The category filter only kicks in if you
    // enable "Search only the enabled categories"; the "hide quest" toggle is optional too.
    const filtered = useMemo(() => {
        const q = usernameQuery.trim().toLowerCase();
        return members
            .map(m => ({
                ...m,
                badges: m.badges.filter(b => {
                    if (s.searchRespectCategories && !isCategoryEnabled(b)) return false;
                    if (s.searchHideQuestBadges && getCategory(b) === "quests") return false;
                    return true;
                })
            }))
            .filter(m => {
                if (lengthFilter != null && m.user.username.length !== lengthFilter) return false;
                if (q && !m.user.username.toLowerCase().includes(q) && !m.name.toLowerCase().includes(q)) return false;
                return true;
            });
    }, [
        members, usernameQuery, lengthFilter, s.searchHideQuestBadges, s.searchRespectCategories,
        s.showNitro, s.showBoost, s.showHypeSquad, s.showHypeSquadEvents, s.showDiscordPrograms,
        s.showLegacyUsername, s.showQuests, s.showOther
    ]);

    const missing = filtered.filter(m => !m.done);
    const loadMissing = () => queueProfiles(missing.map(m => m.user.id));

    function startMemberScan() {
        setScan({ loaded: rawLoaded, total: memberCount || 0, done: false, cancelled: false });
        scanGuildMembers(
            guildId,
            progress => setScan(progress.done ? null : progress),
            s.memberScanSpeed
        );
    }

    function stopMemberScan() {
        cancelAllMemberScans();
        setScan(null);
    }

    const scanning = scan != null;

    // Enquanto a varredura roda (ou se "carregar badges ao abrir" estiver ligado), vai puxando os
    // perfis dos membros que faltam, pra Nitro/impulso surgirem junto com a lista. A fila deduplica,
    // então repetir é barato e garante que nada fica de fora.
    // While the scan runs (or if "load badges on open" is on), keep pulling the profiles of the
    // missing members, so Nitro/boost appear alongside the list. The queue dedupes, so repeating is
    // cheap and nothing gets left behind.
    useEffect(() => {
        if (!s.searchAutoLoad && !scanning) return;

        const notDone = filtered.filter(m => !m.done);
        if (!notDone.length) return;

        const limit = s.searchAutoLoadLimit;
        const allowed = limit > 0 ? Math.max(0, limit - (filtered.length - notDone.length)) : notDone.length;
        if (allowed <= 0) return;

        queueProfiles(notDone.slice(0, allowed).map(m => m.user.id));
    }, [filtered, s.searchAutoLoad, s.searchAutoLoadLimit, scanning]);

    useEffect(() => () => cancelAllMemberScans(), []);

    // badges entre os membros filtrados, com contagem / badges among the filtered members, with counts
    const groups = useMemo(() => {
        const map = new Map<string, { badge: SimpleBadge; count: number; }>();
        for (const m of filtered) {
            for (const b of m.badges) {
                const g = map.get(b.id);
                if (g) g.count++;
                else map.set(b.id, { badge: b, count: 1 });
            }
        }
        return [...map.values()].sort((a, b) =>
            badgeSortRank(a.badge) - badgeSortRank(b.badge) || b.count - a.count
        );
    }, [filtered]);

    // filtra os botões de badge pelo texto digitado / narrows the badge chips by the typed text
    const shownGroups = useMemo(() => {
        const q = badgeQuery.trim().toLowerCase();
        if (!q) return groups;
        return groups.filter(({ badge }) =>
            getBadgeLabel(badge).toLowerCase().includes(q) || badge.id.toLowerCase().includes(q)
        );
    }, [groups, badgeQuery]);

    const results = useMemo(() => {
        if (!selected.length) return [];
        const has = (m: MemberEntry, id: string) => m.badges.some(b => b.id === id);
        return filtered
            .filter(m => s.searchMatchMode === "any"
                ? selected.some(id => has(m, id))
                : selected.every(id => has(m, id)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [filtered, selected, s.searchMatchMode]);

    const toggle = (id: string) =>
        setSelected(sel => sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);

    function sendMessage(userId: string) {
        if (s.searchCloseOnMessage) modalProps.onClose();
        // O Discord agora espera um objeto; passar só o ID (como o openPrivateChannel do Vencord
        // faz) cria um grupo vazio. / Discord now expects an object; passing just the ID (like
        // Vencord's openPrivateChannel helper does) creates an empty group DM.
        ChannelActionCreators.openPrivateChannel({ recipientIds: [userId], navigateToChannel: true });
    }

    const emptyText = s.searchMatchMode === "any"
        ? t("Nobody has any of the selected badges.", "Ninguém tem nenhuma das badges selecionadas.")
        : t("Nobody has all the selected badges.", "Ninguém tem todas as badges selecionadas.");
    const messageLabel = (name: string) => t(`Send a message to ${name}`, `Mandar mensagem para ${name}`);

    return (
        <Modal
            {...modalProps}
            size="md"
            title={t("Search badges", "Pesquisar badges")}
            subtitle={guild ? t(`in ${guild.name}`, `em ${guild.name}`) : undefined}
        >
            <div className="vc-badgesplus-search">
                <div className="vc-badgesplus-search-info">
                    <span>
                        {plural(members.length, "member loaded", "members loaded", "membro carregado", "membros carregados")}
                        {memberCount ? t(` of ${memberCount}`, ` de ${memberCount}`) : ""}
                        {" · "}{t(`${members.length - missing.length} with full badges`, `${members.length - missing.length} com badges completas`)}
                    </span>
                    {pending > 0
                        ? (
                            <span>
                                {t(`Loading… ${pending} left`, `Carregando… ${pending} restantes`)}{" · "}
                                <button className="vc-badgesplus-link" onClick={clearQueue}>{t("Stop", "Parar")}</button>
                            </span>
                        )
                        : missing.length > 0 && (
                            <button className="vc-badgesplus-link" onClick={loadMissing}>
                                {t(`Load badges of ${missing.length} members`, `Carregar badges de ${missing.length} membros`)}
                            </button>
                        )}
                </div>

                {(scan || (memberCount > 0 && rawLoaded < memberCount)) && (
                    <div className="vc-badgesplus-search-info">
                        {scan
                            ? (
                                <span>
                                    {t(
                                        `Scanning members… ${scan.loaded}${scan.total ? `/${scan.total}` : ""}`,
                                        `Varrendo membros… ${scan.loaded}${scan.total ? `/${scan.total}` : ""}`
                                    )}{" · "}
                                    <button className="vc-badgesplus-link" onClick={stopMemberScan}>{t("Stop", "Parar")}</button>
                                </span>
                            )
                            : (
                                <>
                                    <span>
                                        {t("Discord only sent part of the member list.", "O Discord mandou só parte da lista de membros.")}
                                    </span>
                                    <button className="vc-badgesplus-link" onClick={startMemberScan}>
                                        {t("Load more members", "Carregar mais membros")}
                                    </button>
                                </>
                            )}
                    </div>
                )}

                <div className="vc-badgesplus-controls">
                    <input
                        className="vc-badgesplus-input"
                        value={usernameQuery}
                        onChange={e => setUsernameQuery(e.target.value)}
                        placeholder={t("Filter by username…", "Filtrar por nome…")}
                    />
                    <div className="vc-badgesplus-len">
                        <input
                            className="vc-badgesplus-input vc-badgesplus-leninput"
                            type="number"
                            min={1}
                            max={32}
                            value={lenInput}
                            onChange={e => setLenInput(e.target.value)}
                            placeholder={t("chars", "letras")}
                            aria-label={t("Username length", "Tamanho do nome de usuário")}
                        />
                        {[2, 3, 4].map(n => (
                            <button
                                key={n}
                                className={classes("vc-badgesplus-lenbtn", lengthFilter === n && "vc-badgesplus-lenbtn-active")}
                                aria-pressed={lengthFilter === n}
                                onClick={() => setLenInput(lengthFilter === n ? "" : String(n))}
                            >
                                {n}
                            </button>
                        ))}
                    </div>
                    <input
                        className="vc-badgesplus-input"
                        value={badgeQuery}
                        onChange={e => setBadgeQuery(e.target.value)}
                        placeholder={t("Find a badge (e.g. opal, ruby)…", "Achar uma badge (ex.: opala, rubi)…")}
                    />
                </div>

                {shownGroups.length > 0
                    ? (
                        <div className="vc-badgesplus-chips">
                            {shownGroups.map(({ badge, count }) => {
                                const isSelected = selected.includes(badge.id);
                                return (
                                    <button
                                        key={badge.id}
                                        className={classes("vc-badgesplus-chip", isSelected && "vc-badgesplus-chip-selected")}
                                        aria-pressed={isSelected}
                                        onClick={() => toggle(badge.id)}
                                    >
                                        <img src={badgeIconUrl(badge.icon)} width={16} height={16} alt="" />
                                        <span>{getBadgeLabel(badge)}</span>
                                        <span className="vc-badgesplus-count">{count}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )
                    : <div className="vc-badgesplus-search-info">{t("No badges found yet. Load the members' badges above.", "Nenhuma badge encontrada ainda. Carregue as badges dos membros acima.")}</div>}

                {selected.length > 0 && (
                    <div className="vc-badgesplus-results">
                        <div className="vc-badgesplus-search-info">
                            <span>
                                {results.length === 0
                                    ? emptyText
                                    : plural(results.length, "person found", "people found", "pessoa encontrada", "pessoas encontradas")}
                            </span>
                            <button className="vc-badgesplus-link" onClick={() => setSelected([])}>{t("Clear selection", "Limpar seleção")}</button>
                        </div>
                        {results.slice(0, s.searchMaxResults).map(m => (
                            <div key={m.user.id} className="vc-badgesplus-row">
                                <div className="vc-badgesplus-person" onClick={() => openUserProfile(m.user.id)}>
                                    <img
                                        className="vc-badgesplus-avatar"
                                        src={m.user.getAvatarURL(guildId, 32)}
                                        width={32}
                                        height={32}
                                        alt=""
                                    />
                                    <div className="vc-badgesplus-names">
                                        <span className="vc-badgesplus-name">{m.name}</span>
                                        <span className="vc-badgesplus-username">{m.user.username}</span>
                                    </div>
                                </div>
                                <div className="vc-badgesplus-row-badges">
                                    {m.badges.map(b => (
                                        <BadgeIcon key={b.id} badge={b} size={20} dim={!selected.includes(b.id)} />
                                    ))}
                                </div>
                                {s.searchShowMessageButton && m.user.id !== myId && !m.user.bot && (
                                    <Tooltip text={messageLabel(m.name)}>
                                        {props => (
                                            <button
                                                {...props}
                                                className="vc-badgesplus-message"
                                                aria-label={messageLabel(m.name)}
                                                onClick={() => sendMessage(m.user.id)}
                                            >
                                                <MessageIcon />
                                            </button>
                                        )}
                                    </Tooltip>
                                )}
                            </div>
                        ))}
                        {results.length > s.searchMaxResults && (
                            <div className="vc-badgesplus-search-info">{t(`Showing the first ${s.searchMaxResults}.`, `Mostrando os primeiros ${s.searchMaxResults}.`)}</div>
                        )}
                    </div>
                )}
            </div>
        </Modal>
    );
}

export function openSearchBadges(guildId: string) {
    openModal(modalProps => <SearchBadgesModal guildId={guildId} modalProps={modalProps} />);
}
