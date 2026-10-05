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

import { badgeIconUrl, badgeSortRank, getBadgeLabel, getFlagBadges, getTooltip, SimpleBadge } from "./badges";
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
        const onChange = () => {
            clearTimeout(timer);
            timer = setTimeout(() => setTick(n => n + 1), 250);
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
    const missing = members.filter(m => !m.done);
    const pending = pendingCount();
    // total já carregado, sem o filtro de bots / total already loaded, without the bot filter
    const rawLoaded = GuildMemberStore.getMemberIds(guildId).length;
    const [scan, setScan] = useState<MemberScanProgress | null>(null);

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

    useEffect(() => {
        if (s.searchAutoLoad) loadMissing();
        return () => cancelAllMemberScans();
    }, []);

    // badges entre os membros carregados, com contagem / badges among loaded members, with counts
    const groups = useMemo(() => {
        const map = new Map<string, { badge: SimpleBadge; count: number; }>();
        for (const m of members) {
            for (const b of m.badges) {
                const g = map.get(b.id);
                if (g) g.count++;
                else map.set(b.id, { badge: b, count: 1 });
            }
        }
        return [...map.values()].sort((a, b) =>
            badgeSortRank(a.badge) - badgeSortRank(b.badge) || b.count - a.count
        );
    }, [members]);

    const results = useMemo(() => {
        if (!selected.length) return [];
        const has = (m: MemberEntry, id: string) => m.badges.some(b => b.id === id);
        return members
            .filter(m => s.searchMatchMode === "any"
                ? selected.some(id => has(m, id))
                : selected.every(id => has(m, id)))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [members, selected, s.searchMatchMode]);

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

                {groups.length > 0
                    ? (
                        <div className="vc-badgesplus-chips">
                            {groups.map(({ badge, count }) => {
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
