/*
 * BadgesPlus, a Vencord userplugin
 * Copyright (c) 2026 lirenzzzin
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./style.css";

import { addMemberListDecorator, removeMemberListDecorator } from "@api/MemberListDecorators";
import { addMessageDecoration, removeMessageDecoration } from "@api/MessageDecorations";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { findComponentByCodeLazy } from "@webpack";
import { SelectedGuildStore, useStateFromStores } from "@webpack/common";
import type { ReactNode } from "react";

import { t } from "./i18n";
import { clearQueue, setConcurrency, setMinDelay } from "./profileQueue";
import { openSearchBadges } from "./SearchModal";
import { settings } from "./settings";
import { UserBadges } from "./UserBadges";

// botão nativo da barra do canal / native channel toolbar button (same as pins / member list)
const HeaderBarIcon = findComponentByCodeLazy("tooltipPosition:", '"aria-haspopup":', '"data-jump-section":');

function NitroIcon({ className, width = 24, height = 24 }: { className?: string; width?: number; height?: number; }) {
    return (
        <svg className={className} width={width} height={height} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path
                fillRule="evenodd"
                d="M14.5 4.5a7.5 7.5 0 1 1 0 15a7.5 7.5 0 0 1 0-15Zm0 3.75a3.75 3.75 0 1 0 0 7.5a3.75 3.75 0 0 0 0-7.5Z"
            />
            <rect x="1" y="7" width="5.5" height="2" rx="1" />
            <rect x="2.5" y="11" width="4" height="2" rx="1" />
            <rect x="1" y="15" width="5.5" height="2" rx="1" />
        </svg>
    );
}

function SearchBadgesButton() {
    const { showSearchButton } = settings.use(["showSearchButton"]);
    const guildId = useStateFromStores([SelectedGuildStore], () => SelectedGuildStore.getGuildId());
    if (!showSearchButton || !guildId) return null;

    return (
        <HeaderBarIcon
            icon={NitroIcon}
            tooltip={t("Search badges", "Pesquisar badges")}
            aria-label={t("Search badges", "Pesquisar badges")}
            onClick={() => openSearchBadges(guildId)}
        />
    );
}

export default definePlugin({
    name: "BadgesPlus",
    description: "Profile badges next to names (chat & member list) + search members by badge. / Badges do perfil ao lado do nome (chat e lista de membros) + pesquisa de membros por badge.",
    authors: [{ name: "lirenzzzin", id: 0n }],
    dependencies: ["MessageDecorationsAPI", "MemberListDecoratorsAPI"],
    settings,

    patches: [
        {
            find: "Missing channel in Channel.renderHeaderToolbar",
            replacement: {
                match: /(?<=renderHeaderToolbar"\);let (\i)=\[\];)/,
                replace: "$self.addToolbarButton($1);"
            }
        }
    ],

    addToolbarButton(toolbar: ReactNode[]) {
        toolbar.push(
            <ErrorBoundary noop key="vc-badgesplus-search">
                <SearchBadgesButton />
            </ErrorBoundary>
        );
    },

    start() {
        setMinDelay(settings.store.loadSpeed);
        setConcurrency(settings.store.loadConcurrency);

        addMessageDecoration("vc-badgesplus", props =>
            props.message?.author ? <UserBadges user={props.message.author} where="chat" /> : null
        );
        addMemberListDecorator("vc-badgesplus", ({ user }) =>
            user ? <UserBadges user={user} where="list" /> : null
        );
    },

    stop() {
        clearQueue();
        removeMessageDecoration("vc-badgesplus");
        removeMemberListDecorator("vc-badgesplus");
    }
});
