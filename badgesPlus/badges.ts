/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { User } from "@vencord/discord-types";

import { plural, t } from "./i18n";
import { settings } from "./settings";

export interface SimpleBadge {
    id: string;
    description: string;
    icon: string;
}

export const badgeIconUrl = (icon: string) => `https://cdn.discordapp.com/badge-icons/${icon}.png`;

// Badges que dá pra descobrir só pelas flags públicas, sem buscar o perfil.
// Badges that can be read from public flags alone, without fetching the profile.
// Nitro/boost only show up once the full profile is loaded.
const FLAG_BADGES: Array<SimpleBadge & { flag: number; }> = [
    { flag: 1 << 0, id: "staff", description: "Discord Staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d" },
    { flag: 1 << 1, id: "partner", description: "Partnered Server Owner", icon: "3f9748e53446a137a052f3454e2de41e" },
    { flag: 1 << 18, id: "certified_moderator", description: "Moderator Programs Alumni", icon: "fee1624003e2fee35cb398e125dc479b" },
    { flag: 1 << 2, id: "hypesquad", description: "HypeSquad Events", icon: "bf01d1073931f921909045f3a39fd264" },
    { flag: 1 << 6, id: "hypesquad_house_1", description: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02" },
    { flag: 1 << 7, id: "hypesquad_house_2", description: "HypeSquad Brilliance", icon: "011940fd013da3f7fb926e4a1cd2e618" },
    { flag: 1 << 8, id: "hypesquad_house_3", description: "HypeSquad Balance", icon: "3aa41de486fa12454c3761e8e223442e" },
    { flag: 1 << 3, id: "bug_hunter_level_1", description: "Discord Bug Hunter", icon: "2717692c7dca7289b35297368a940dd0" },
    { flag: 1 << 14, id: "bug_hunter_level_2", description: "Discord Bug Hunter", icon: "848f79194d4be5ff5f81505cbd0ce1e6" },
    { flag: 1 << 22, id: "active_developer", description: "Active Developer", icon: "6bdc42827a38498929a4920da12695d9" },
    { flag: 1 << 17, id: "verified_developer", description: "Early Verified Bot Developer", icon: "6df5892e0f35b051f8b61eace34f4967" },
    { flag: 1 << 9, id: "early_supporter", description: "Early Supporter", icon: "7060786766c9c840eb3019e725d2b358" },
];

export function getFlagBadges(user: User): SimpleBadge[] {
    const flags = user.publicFlags ?? 0;
    return FLAG_BADGES.filter(b => (flags & b.flag) === b.flag);
}

// ---- Nomes / Names -----------------------------------------------------------

const LABELS: Record<string, [en: string, pt: string]> = {
    premium: ["Nitro", "Nitro"],
    staff: ["Discord Staff", "Funcionário do Discord"],
    partner: ["Partner", "Parceiro"],
    certified_moderator: ["Moderator Alumni", "Ex-moderador"],
    hypesquad: ["HypeSquad Events", "HypeSquad Eventos"],
    hypesquad_house_1: ["HypeSquad Bravery", "HypeSquad Bravery"],
    hypesquad_house_2: ["HypeSquad Brilliance", "HypeSquad Brilliance"],
    hypesquad_house_3: ["HypeSquad Balance", "HypeSquad Balance"],
    bug_hunter_level_1: ["Bug Hunter", "Caçador de Bugs"],
    bug_hunter_level_2: ["Bug Hunter Level 2", "Caçador de Bugs Nível 2"],
    active_developer: ["Active Developer", "Desenvolvedor Ativo"],
    verified_developer: ["Verified Bot Developer", "Dev de Bot Verificado"],
    early_supporter: ["Early Supporter", "Apoiador Inicial"],
    legacy_username: ["Originally known as", "Nome antigo"],
    quest_completed: ["Completed a Quest", "Missão concluída"],
    orb_profile_badge: ["Orbs", "Orbs"],
    bot_commands: ["Supports Commands", "Comandos de bot"],
    automod: ["AutoMod", "AutoMod"],
    application_guild_subscription: ["App subscription", "Assinatura de app"],
};

const TENURE: Record<number, [en: string, pt: string]> = {
    1: ["Bronze", "Bronze"],
    3: ["Silver", "Prata"],
    6: ["Gold", "Ouro"],
    12: ["Platinum", "Platina"],
    24: ["Diamond", "Diamante"],
    36: ["Emerald", "Esmeralda"],
    60: ["Ruby", "Rubi"],
    72: ["Opal", "Opala"],
};

const BOOST_MONTHS = [0, 1, 2, 3, 6, 9, 12, 15, 18, 24];

const tenureMonths = (id: string) => Number(/^premium_tenure_(\d+)_month/.exec(id)?.[1] ?? NaN);
const boostLevel = (id: string) => Number(/^guild_booster_lvl(\d+)/.exec(id)?.[1] ?? NaN);

/** Nome curto da badge / Short badge name */
export function getBadgeLabel(badge: SimpleBadge): string {
    if (LABELS[badge.id]) return t(...LABELS[badge.id]);

    const months = tenureMonths(badge.id);
    if (!isNaN(months)) {
        const tier = TENURE[months] ? t(...TENURE[months]) : plural(months, "month", "months", "mês", "meses");
        return `Nitro ${tier}`;
    }

    const lvl = boostLevel(badge.id);
    if (!isNaN(lvl)) {
        const m = BOOST_MONTHS[lvl] ?? lvl;
        return `${t("Boost", "Impulso")} ${plural(m, "month", "months", "mês", "meses")}`;
    }

    // badge nova / new badge: usa o texto do Discord / use Discord's text
    return badge.description;
}

export const getTooltip = (badge: SimpleBadge) =>
    settings.store.tooltipText === "discord" ? badge.description : getBadgeLabel(badge);

// ---- Categorias / Categories ------------------------------------------------

type Category = "nitro" | "boost" | "hypesquad" | "hypesquadEvents" | "programs" | "legacy" | "quests" | "other";

const PROGRAMS = new Set([
    "staff", "partner", "certified_moderator", "bug_hunter_level_1", "bug_hunter_level_2",
    "active_developer", "verified_developer", "early_supporter"
]);

export function getCategory(badge: SimpleBadge): Category {
    const { id } = badge;
    if (id === "premium" || id.startsWith("premium_tenure_")) return "nitro";
    if (id.startsWith("guild_booster_")) return "boost";
    // HypeSquad Events é uma badge antiga e separada das três casas / HypeSquad Events is an
    // old badge, kept separate from the three houses
    if (id === "hypesquad") return "hypesquadEvents";
    if (id.startsWith("hypesquad_house_")) return "hypesquad";
    if (PROGRAMS.has(id)) return "programs";
    if (id === "legacy_username") return "legacy";
    if (id.startsWith("quest") || id.startsWith("orb")) return "quests";
    return "other";
}

const CATEGORY_SETTING = {
    nitro: "showNitro",
    boost: "showBoost",
    hypesquad: "showHypeSquad",
    hypesquadEvents: "showHypeSquadEvents",
    programs: "showDiscordPrograms",
    legacy: "showLegacyUsername",
    quests: "showQuests",
    other: "showOther",
} as const;

export const isCategoryEnabled = (badge: SimpleBadge) =>
    settings.store[CATEGORY_SETTING[getCategory(badge)]];

// ---- Ordem / Order ---------------------------------------------------------

const isNitroOrBoost = (b: SimpleBadge) => ["nitro", "boost"].includes(getCategory(b));

/** Aplica filtros e ordem das configurações / Applies the filters and order from settings */
export function filterAndSortBadges(badges: SimpleBadge[]): SimpleBadge[] {
    const visible = badges.filter(isCategoryEnabled);

    switch (settings.store.badgeOrder) {
        case "nitroFirst":
            return [...visible.filter(isNitroOrBoost), ...visible.filter(b => !isNitroOrBoost(b))];
        case "nitroLast":
            return [...visible.filter(b => !isNitroOrBoost(b)), ...visible.filter(isNitroOrBoost)];
        default:
            return visible;
    }
}

/** Ordem dos botões no pesquisador / Button order in the search: Nitro, tiers, boosts, rest */
export function badgeSortRank(badge: SimpleBadge): number {
    if (badge.id === "premium") return 0;
    const months = tenureMonths(badge.id);
    if (!isNaN(months)) return 1 + months / 1000;
    const lvl = boostLevel(badge.id);
    if (!isNaN(lvl)) return 2 + lvl / 100;
    return 3;
}
