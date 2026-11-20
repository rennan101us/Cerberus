import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useTranslation } from "react-i18next";
import {
  BellIcon,
  DashIcon,
  PeopleIcon,
  ScreenFullIcon,
  ScreenNormalIcon,
  VideoIcon,
  XIcon,
} from "@primer/octicons-react";
import cn from "classnames";

import { MAIN_WINDOW_TITLE_BAR_HEIGHT } from "@shared";
import type {
  NotificationCountResponse,
  NotificationsChangedDetail,
} from "@types";
import { useUserDetails } from "@renderer/hooks";
import HydraIcon from "@renderer/assets/icons/hydra.svg?react";
import Notifications from "@renderer/pages/notifications/notifications";

import { NavigationArrows } from "../navigation-arrows/navigation-arrows";
import { ChangelogModal } from "../changelog-modal/changelog-modal";
import { TitleBarSearch } from "./title-bar-search";
import "./app-title-bar.scss";
import "./title-bar-search.scss";

const titleBarStyle = {
  "--title-bar-height": `${MAIN_WINDOW_TITLE_BAR_HEIGHT}px`,
} as CSSProperties;

export interface AppTitleBarProps {
  hasActiveSubscription: boolean;
  version: string;
  isWindowMaximized: boolean;
}

/**
 * The main window's only bar: Cerberus brand and version over the sidebar, back and
 * forward where the pages start, search in the middle, and the window
 * controls each platform needs.
 */
export function AppTitleBar({
  version,
  isWindowMaximized,
}: Readonly<AppTitleBarProps>) {
  const { t } = useTranslation(["header", "sidebar"]);
  const [showChangelogModal, setShowChangelogModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [onlineFriendsCount, setOnlineFriendsCount] = useState(0);
  const [unreadChatCount, setUnreadChatCount] = useState(0);
  const apiNotificationCountRef = useRef(0);
  const notificationsAnchorRef = useRef<HTMLDivElement | null>(null);
  const { userDetails } = useUserDetails();

  useEffect(() => {
    let cancelled = false;
    const loadSocial = async () => {
      try {
        const [snapshot, unread] = await Promise.all([
          window.electron.socialGetFriends().catch(() => null),
          window.electron.getChatUnreadState().catch(() => null),
        ]);
        if (cancelled) return;
        if (snapshot) setOnlineFriendsCount(snapshot.onlineFriends);
        if (unread) setUnreadChatCount(unread.totalUnread);
      } catch {
        // ignore
      }
    };
    void loadSocial();
    const unsubFriends = window.electron.onFriendsUpdated(() => void loadSocial());
    const unsubPresence = window.electron.onFriendPresence(() => void loadSocial());
    const unsubAccounts = window.electron.onStoreAccountsUpdated(() => void loadSocial());
    const unsubUnread = window.electron.onChatUnreadUpdated((u) => {
      if (!cancelled) setUnreadChatCount(u.totalUnread);
    });
    return () => {
      cancelled = true;
      unsubFriends();
      unsubPresence();
      unsubAccounts();
      unsubUnread();
    };
  }, []);

  useEffect(() => {
    if (!showNotificationsModal) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        notificationsAnchorRef.current &&
        !notificationsAnchorRef.current.contains(event.target as Node)
      ) {
        setShowNotificationsModal(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowNotificationsModal(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showNotificationsModal]);

  const fetchLocalNotificationCount = useCallback(async () => {
    try {
      const localCount = await window.electron.getLocalNotificationsCount();
      setNotificationCount(localCount + apiNotificationCountRef.current);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void fetchLocalNotificationCount();
    const unsubCreated = window.electron.onLocalNotificationCreated(() => {
      void fetchLocalNotificationCount();
    });
    const unsubSync = window.electron.onSyncNotificationCount((notification) => {
      apiNotificationCountRef.current = notification.notificationCount;
      void fetchLocalNotificationCount();
    });
    const handleNotificationsChange = (event: Event) => {
      const detail = (event as CustomEvent<NotificationsChangedDetail>).detail;
      if (detail?.resetApiUnread) {
        apiNotificationCountRef.current = 0;
      } else if (typeof detail?.apiUnreadDelta === "number") {
        apiNotificationCountRef.current = Math.max(
          0,
          apiNotificationCountRef.current + detail.apiUnreadDelta
        );
      }
      void fetchLocalNotificationCount();
    };
    window.addEventListener("notificationsChanged", handleNotificationsChange);
    return () => {
      unsubCreated();
      unsubSync();
      window.removeEventListener(
        "notificationsChanged",
        handleNotificationsChange
      );
    };
  }, [fetchLocalNotificationCount]);

  useEffect(() => {
    if (!userDetails) {
      apiNotificationCountRef.current = 0;
      void fetchLocalNotificationCount();
      return;
    }
    window.electron.hydraApi
      .get<NotificationCountResponse>("/profile/notifications/count", {
        needsAuth: true,
      })
      .then((res) => {
        apiNotificationCountRef.current = res.count;
        void fetchLocalNotificationCount();
      })
      .catch(() => {});
  }, [userDetails, fetchLocalNotificationCount]);

  const { platform, hasNativeWindowDecorations } = window.electron;

  const hasCustomWindowControls =
    platform === "linux" && !hasNativeWindowDecorations;

  return (
    <>
      <header
        className={cn("title-bar", {
          "title-bar--windows": platform === "win32",
          "title-bar--darwin": platform === "darwin",
        })}
        style={titleBarStyle}
      >
        <div className="title-bar__brand">
          <HydraIcon width={18} height={18} aria-hidden="true" />
          <h4>Cerberus</h4>

          {version && (
            <button
              type="button"
              onClick={() => setShowChangelogModal(true)}
              className="title-bar__version"
              title="Ver notas de versão do Cerberus"
            >
              v{version}
            </button>
          )}
        </div>

      <NavigationArrows className="title-bar__navigation" />

      <div className="title-bar__search">
        <TitleBarSearch />
      </div>

      <button
        type="button"
        className="title-bar__friends"
        onClick={() => void window.electron.openFriendsWindow()}
        title="Amigos & Chat (Steam / Epic)"
      >
        <PeopleIcon size={14} />
        <span>Amigos</span>
        {onlineFriendsCount > 0 && (
          <span className="title-bar__friends-online">
            {onlineFriendsCount}
          </span>
        )}
        {unreadChatCount > 0 && (
          <span className="title-bar__notifications-badge">
            {unreadChatCount > 99 ? "99+" : unreadChatCount}
          </span>
        )}
      </button>

      <div
        className="title-bar__notifications-anchor"
        ref={notificationsAnchorRef}
      >
        <button
          type="button"
          className={cn("title-bar__notifications", {
            "title-bar__notifications--active": showNotificationsModal,
          })}
          onClick={() => setShowNotificationsModal((prev) => !prev)}
          title={t("notifications", { ns: "sidebar" })}
          aria-label={t("notifications", { ns: "sidebar" })}
          aria-expanded={showNotificationsModal}
        >
          <BellIcon size={14} />
          {notificationCount > 0 && (
            <span className="title-bar__notifications-badge">
              {notificationCount > 99 ? "99+" : notificationCount}
            </span>
          )}
        </button>

        {showNotificationsModal && (
          <div
            className="title-bar__notifications-popover"
            role="dialog"
            aria-label={t("notifications", { ns: "sidebar" })}
          >
            <div className="title-bar__notifications-popover-head">
              <strong>{t("notifications", { ns: "sidebar" })}</strong>
              <button
                type="button"
                className="title-bar__notifications-popover-close"
                onClick={() => setShowNotificationsModal(false)}
                aria-label="Fechar notificações"
              >
                <XIcon size={14} />
              </button>
            </div>
            <Notifications inModal />
          </div>
        )}
      </div>

      <button
        type="button"
        className="title-bar__big-picture"
        onClick={() => window.electron.openBigPictureWindow()}
      >
        <VideoIcon size={14} />
        {t("big_picture", { ns: "sidebar" })}
      </button>

      {hasCustomWindowControls && (
        <div className="title-bar__window-controls">
          <button
            type="button"
            className="title-bar__window-control"
            onClick={() => window.electron.minimizeMainWindow()}
            title={t("minimize")}
            aria-label={t("minimize")}
          >
            <DashIcon size={16} />
          </button>
          <button
            type="button"
            className="title-bar__window-control"
            onClick={() => window.electron.toggleMaximizeMainWindow()}
            title={isWindowMaximized ? t("restore") : t("maximize")}
            aria-label={isWindowMaximized ? t("restore") : t("maximize")}
          >
            {isWindowMaximized ? (
              <ScreenNormalIcon size={16} />
            ) : (
              <ScreenFullIcon size={16} />
            )}
          </button>
          <button
            type="button"
            className="title-bar__window-control title-bar__window-control--close"
            onClick={() => window.electron.closeMainWindow()}
            title={t("close")}
            aria-label={t("close")}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
    </header>

    <ChangelogModal
      visible={showChangelogModal}
      onClose={() => setShowChangelogModal(false)}
    />
  </>
  );
}
