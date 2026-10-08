/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

import { t } from "./i18n";
import { setConcurrency, setMinDelay } from "./profileQueue";

/**
 * Adiciona nome e descrição traduzidos. São getters para que a tela de configurações
 * mostre o idioma atual sempre que for aberta.
 * Adds translated name and description as getters, so the settings screen always
 * shows the current language.
 */
function tr<const T extends object>(def: T, name: [en: string, pt: string], desc: [en: string, pt: string]) {
    return Object.defineProperties(def, {
        displayName: { get: () => t(...name), enumerable: true },
        description: { get: () => t(...desc), enumerable: true },
    }) as T & { displayName: string; description: string; };
}

export const settings = definePluginSettings({
    language: {
        type: OptionType.SELECT,
        displayName: "Language / Idioma",
        description: "Language of the plugin. / Idioma do plugin.",
        options: [
            { label: "Auto (Discord)", value: "auto", default: true },
            { label: "English", value: "en" },
            { label: "Português", value: "pt" },
        ]
    },

    // ---- Where to show / Onde mostrar -----------------------------------------
    showInChat: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Show in chat", "Mostrar no chat"],
        ["Shows badges right after the name in messages.", "Mostra as badges logo depois do nome nas mensagens."]
    ),
    showInMemberList: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Show in member list", "Mostrar na lista de membros"],
        ["Shows badges right after the name in the member list (servers and DMs).", "Mostra as badges logo depois do nome na lista de membros (servidores e DMs)."]
    ),
    showOnSelf: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Show my own badges", "Mostrar as minhas badges"],
        ["Also shows badges on your own account.", "Mostra as badges na sua própria conta também."]
    ),
    showOnBots: tr(
        { type: OptionType.BOOLEAN, default: false },
        ["Show on bots", "Mostrar em bots"],
        ["Shows badges on bots (e.g. Supports Commands, AutoMod).", "Mostra badges em bots (ex.: Comandos de bot, AutoMod)."]
    ),

    // ---- Appearance / Aparência -----------------------------------------------
    chatBadgeSize: tr(
        { type: OptionType.SLIDER, markers: [12, 14, 16, 18, 20, 22, 24], default: 18, stickToMarkers: true },
        ["Size in chat", "Tamanho no chat"],
        ["Badge size in chat, in pixels.", "Tamanho das badges no chat, em pixels."]
    ),
    memberListBadgeSize: tr(
        { type: OptionType.SLIDER, markers: [12, 14, 16, 18, 20, 22, 24], default: 16, stickToMarkers: true },
        ["Size in member list", "Tamanho na lista de membros"],
        ["Badge size in the member list, in pixels.", "Tamanho das badges na lista de membros, em pixels."]
    ),
    badgeSpacing: tr(
        { type: OptionType.SLIDER, markers: [0, 1, 2, 3, 4, 6, 8], default: 3, stickToMarkers: true },
        ["Space between badges", "Espaço entre badges"],
        ["Space between one badge and the next, in pixels.", "Espaço entre uma badge e outra, em pixels."]
    ),
    maxBadges: tr(
        { type: OptionType.SLIDER, markers: [0, 1, 2, 3, 4, 5, 6, 8, 10], default: 0, stickToMarkers: true },
        ["Max badges per person", "Máximo de badges por pessoa"],
        ["How many badges to show next to the name. 0 = all.", "Quantas badges mostrar ao lado do nome. 0 = todas."]
    ),
    showOverflowCount: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Show \"+N\" when over the limit", "Mostrar \"+N\" quando passar do máximo"],
        ["Shows how many badges were hidden by the limit above.", "Mostra quantas badges ficaram escondidas pelo limite acima."]
    ),
    badgeOrder: tr(
        {
            type: OptionType.SELECT,
            get options() {
                return [
                    { label: t("Same as the Discord profile", "Igual ao perfil do Discord"), value: "discord", default: true },
                    { label: t("Nitro and boost first", "Nitro e impulso primeiro"), value: "nitroFirst" },
                    { label: t("Nitro and boost last", "Nitro e impulso por último"), value: "nitroLast" },
                ];
            }
        },
        ["Badge order", "Ordem das badges"],
        ["In which order badges appear next to the name.", "Em que ordem as badges aparecem ao lado do nome."]
    ),
    tooltipText: tr(
        {
            type: OptionType.SELECT,
            get options() {
                return [
                    { label: t("Short name (e.g. Nitro Opal)", "Nome curto (ex.: Nitro Opala)"), value: "label", default: true },
                    { label: t("Discord's text (e.g. Subscriber since...)", "Texto do Discord (ex.: Assinante desde...)"), value: "discord" },
                ];
            }
        },
        ["Hover text", "Texto ao passar o mouse"],
        ["What shows up when you hover over a badge.", "O que aparece quando você passa o mouse em cima de uma badge."]
    ),

    // ---- Which badges / Quais badges ------------------------------------------
    showNitro: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Nitro badges", "Badges de Nitro"],
        ["Nitro and Nitro tiers (Bronze, Silver, Gold... Opal).", "Nitro e níveis de Nitro (Bronze, Prata, Ouro... Opala)."]
    ),
    showBoost: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Boost badges", "Badges de impulso"],
        ["Server boost (1 month up to 24 months).", "Impulso de servidor (1 mês até 24 meses)."]
    ),
    showHypeSquad: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["HypeSquad houses", "Casas da HypeSquad"],
        ["Bravery, Brilliance and Balance.", "Bravery, Brilliance e Balance."]
    ),
    showHypeSquadEvents: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["HypeSquad Events badge", "Badge HypeSquad Eventos"],
        [
            "The old HypeSquad Events badge, kept separate from the three houses.",
            "A badge antiga HypeSquad Eventos, separada das três casas."
        ]
    ),
    showDiscordPrograms: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Discord program badges", "Badges de programas do Discord"],
        [
            "Staff, Partner, Bug Hunter, Moderator Alumni, Early Supporter, Active Developer, Verified Bot Developer.",
            "Funcionário, Parceiro, Caçador de Bugs, Ex-moderador, Apoiador Inicial, Desenvolvedor Ativo, Dev de Bot Verificado."
        ]
    ),
    showLegacyUsername: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["\"Originally known as\" badge", "Badge \"Nome antigo\""],
        ["The badge for people who had a #tag name before the username change.", "A badge de quem tinha nome com #tag antes da mudança de nomes."]
    ),
    showQuests: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Quest and Orbs badges", "Badges de missões e Orbs"],
        ["Completed a Quest, Orbs and similar.", "Missão concluída, Orbs e similares."]
    ),
    showOther: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Other badges", "Outras badges"],
        ["Any badge that doesn't fit the categories above (including new Discord badges).", "Qualquer badge que não se encaixe nas categorias acima (inclusive badges novas do Discord)."]
    ),

    // ---- Loading / Carregamento -----------------------------------------------
    fetchProfiles: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Load profiles automatically", "Carregar perfis automaticamente"],
        [
            "Fetches the profile of whoever is on screen to find Nitro, boost and other badges that don't come with the user. Without it, only basic badges show up (HypeSquad, Bug Hunter, Early Supporter...).",
            "Busca o perfil de quem aparece na tela para descobrir Nitro, impulso e outras badges que não vêm junto com o usuário. Sem isso, só aparecem as badges básicas (HypeSquad, Caçador de Bugs, Apoiador Inicial...)."
        ]
    ),
    loadSpeed: tr(
        {
            type: OptionType.SELECT,
            get options() {
                return [
                    { label: t("Fast (0.5s)", "Rápido (0,5s)"), value: 500, default: true },
                    { label: t("Normal (1s)", "Normal (1s)"), value: 1000 },
                    { label: t("Safe (2s)", "Seguro (2s)"), value: 2000 },
                    { label: t("Very safe (4s)", "Muito seguro (4s)"), value: 4000 },
                ];
            },
            onChange: (ms: number) => setMinDelay(ms)
        },
        ["Loading speed", "Velocidade de carregamento"],
        [
            "Time between one profile and the next. If Discord asks to slow down, the plugin slows down by itself and speeds up again later.",
            "Intervalo entre um perfil e outro. Se o Discord pedir para ir mais devagar, o plugin desacelera sozinho e depois volta a acelerar."
        ]
    ),
    loadConcurrency: tr(
        {
            type: OptionType.SLIDER,
            markers: [1, 2, 3, 4, 5, 6],
            default: 2,
            stickToMarkers: true,
            onChange: (n: number) => setConcurrency(n)
        },
        ["Profiles at once", "Perfis por vez"],
        [
            "How many profiles to fetch at the same time. Higher is faster; lower it if you keep getting rate limited.",
            "Quantos perfis buscar ao mesmo tempo. Mais alto é mais rápido; diminua se tomar limite de requisições."
        ]
    ),
    fetchBotProfiles: tr(
        { type: OptionType.BOOLEAN, default: false },
        ["Load bot profiles", "Carregar perfil de bots"],
        ["Also fetches bot profiles. Leave off to save requests.", "Também busca o perfil de bots. Deixe desligado para economizar requisições."]
    ),

    // ---- Badge search / Pesquisa de badges ------------------------------------
    showSearchButton: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Badge search button", "Botão de pesquisar badges"],
        [
            "Shows the Nitro button in the channel bar (next to pins and member list) to search members by badge.",
            "Mostra o botão de Nitro na barra do canal (perto de fixados e lista de membros) para pesquisar membros por badge."
        ]
    ),
    searchMatchMode: tr(
        {
            type: OptionType.SELECT,
            get options() {
                return [
                    { label: t("ALL selected badges", "TODAS as selecionadas"), value: "all", default: true },
                    { label: t("ANY of the selected badges", "QUALQUER UMA das selecionadas"), value: "any" },
                ];
            }
        },
        ["With several badges selected, show who has...", "Com várias badges selecionadas, mostrar quem tem..."],
        ["How to combine the selected badges in the search.", "Como combinar as badges selecionadas no pesquisador."]
    ),
    searchAutoLoad: tr(
        { type: OptionType.BOOLEAN, default: false },
        ["Load badges when opening the search", "Carregar badges ao abrir o pesquisador"],
        [
            "Off by default: automatically loading thousands of profiles can get your account globally rate-limited (then nothing loads, not even in DMs). Turn it on if you want it, or just use the Load button.",
            "Desligado por padrão: carregar milhares de perfis sozinho pode colocar sua conta em limite global (aí não carrega nada, nem em DM). Ligue se quiser, ou use o botão Carregar."
        ]
    ),
    memberScanSpeed: tr(
        {
            type: OptionType.SELECT,
            get options() {
                return [
                    { label: t("Fast (250ms)", "Rápido (250ms)"), value: 250 },
                    { label: t("Normal (400ms)", "Normal (400ms)"), value: 400, default: true },
                    { label: t("Safe (700ms)", "Seguro (700ms)"), value: 700 },
                    { label: t("Very safe (1200ms)", "Muito seguro (1200ms)"), value: 1200 },
                ];
            }
        },
        ["Member scan speed", "Velocidade de varredura de membros"],
        [
            "Gap between requests when loading the full member list. These are gateway requests, so they don't use the profile limit.",
            "Intervalo entre requisições ao carregar a lista completa de membros. São requisições de gateway, então não usam o limite de perfil."
        ]
    ),
    searchAutoLoadLimit: tr(
        {
            type: OptionType.SLIDER,
            markers: [0, 200, 500, 1000, 2000],
            default: 0,
            stickToMarkers: true
        },
        ["Auto-load limit (profiles)", "Limite de carregamento automático (perfis)"],
        [
            "How many profiles the search loads automatically when it opens. 0 = all. Lower it if it feels heavy; you can always load the rest with the button.",
            "Quantos perfis o pesquisador carrega sozinho ao abrir. 0 = todos. Diminua se pesar; dá pra carregar o resto no botão."
        ]
    ),
    searchShowMessageButton: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Message button in results", "Botão de mensagem nos resultados"],
        ["Shows the button that opens a DM with the person.", "Mostra o botão que abre a DM com a pessoa."]
    ),
    searchCloseOnMessage: tr(
        { type: OptionType.BOOLEAN, default: true },
        ["Close the search when opening a DM", "Fechar o pesquisador ao abrir DM"],
        ["Closes the search when you click to send a message.", "Fecha o pesquisador quando você clica para mandar mensagem."]
    ),
    searchIncludeBots: tr(
        { type: OptionType.BOOLEAN, default: false },
        ["Include bots in the search", "Incluir bots na pesquisa"],
        ["Shows bots in the results and in the badge counts.", "Mostra bots nos resultados e na contagem das badges."]
    ),
    searchHideQuestBadges: tr(
        { type: OptionType.BOOLEAN, default: false },
        ["Hide quest badges in the search", "Esconder badges de quest no pesquisador"],
        [
            "Keeps Quest/Orbs badges out of the badge buttons and the results. Off by default so the search shows everything.",
            "Tira as badges de Missão/Orbs dos botões e dos resultados. Desligado por padrão pra busca mostrar tudo."
        ]
    ),
    searchRespectCategories: tr(
        { type: OptionType.BOOLEAN, default: false },
        ["Search only the enabled categories", "Pesquisar só as categorias ligadas"],
        [
            "When on, the search only shows the badge categories you enabled under \"Which badges\". Turn it on to pick exactly what the search pulls; off shows everything.",
            "Ligado, o pesquisador só mostra as categorias que você ativou em \"Quais badges\". Ligue pra escolher exatamente o que a busca puxa; desligado mostra tudo."
        ]
    ),
    searchMaxResults: tr(
        { type: OptionType.SLIDER, markers: [50, 100, 200, 300, 500, 1000], default: 300, stickToMarkers: true },
        ["Max results", "Máximo de resultados"],
        ["How many people to show at once in the search.", "Quantas pessoas mostrar de uma vez no pesquisador."]
    ),
}, {
    chatBadgeSize: { hidden() { return !this.store.showInChat; } },
    memberListBadgeSize: { hidden() { return !this.store.showInMemberList; } },
    showOverflowCount: { hidden() { return this.store.maxBadges === 0; } },
    loadSpeed: { hidden() { return !this.store.fetchProfiles && !this.store.showSearchButton; } },
    loadConcurrency: { hidden() { return !this.store.fetchProfiles; } },
    fetchBotProfiles: { hidden() { return !this.store.fetchProfiles; } },
    searchMatchMode: { hidden() { return !this.store.showSearchButton; } },
    searchAutoLoad: { hidden() { return !this.store.showSearchButton; } },
    searchAutoLoadLimit: { hidden() { return !this.store.showSearchButton; } },
    memberScanSpeed: { hidden() { return !this.store.showSearchButton; } },
    searchShowMessageButton: { hidden() { return !this.store.showSearchButton; } },
    searchCloseOnMessage: { hidden() { return !this.store.showSearchButton || !this.store.searchShowMessageButton; } },
    searchIncludeBots: { hidden() { return !this.store.showSearchButton; } },
    searchHideQuestBadges: { hidden() { return !this.store.showSearchButton; } },
    searchRespectCategories: { hidden() { return !this.store.showSearchButton; } },
    searchMaxResults: { hidden() { return !this.store.showSearchButton; } },
});
