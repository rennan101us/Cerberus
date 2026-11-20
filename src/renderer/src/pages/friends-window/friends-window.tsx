import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CommentIcon,
  CopyIcon,
  DashIcon,
  PersonAddIcon,
  SearchIcon,
  XIcon,
} from "@primer/octicons-react";
import { Gamepad2, Play } from "lucide-react";

import { Avatar, Button, Toast } from "@renderer/components";
import { closeToast } from "@renderer/features";
import { useAppDispatch, useAppSelector, useToast } from "@renderer/hooks";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import { buildCerberusInviteUrl } from "@shared";
import type {
  ChatUnreadState,
  FriendRequest,
  SocialFriendsFilter,
  SocialGameInvite,
  SocialInvitableGame,
  StoreAccountsState,
  StoreProvider,
  UserFriend,
} from "@types";

import {
  BACKGROUND_IMAGE_SIZES,
  sortFriendsByUnreadMessages,
} from "./friends-window-layout";
import { useVisibleFriendIds } from "./use-visible-friend-ids";
import { consumeAddFriendRequest } from "./add-friend-request";
import { useAddFriend } from "./use-add-friend";
import "./friends-window.scss";

const COPIED_FEEDBACK_MS = 1200;
const electron = globalThis.electron as Electron;

type FriendImageSize = { width: number; height: number };

const FRIEND_AVATAR_IMAGE_SIZE = { width: 80, height: 80 };
const PROFILE_AVATAR_IMAGE_SIZE = { width: 112, height: 112 };
const FRIEND_IMAGE_PROCESSING_BATCH_SIZE = 6;

const ONLINE_SKELETON_ROWS = [
  [128, 92],
  [96, 52],
  [150, 108],
];
const OFFLINE_SKELETON_ROWS = [
  [112, 48],
  [140, 48],
  [84, 48],
  [124, 48],
];
const SKELETON_FADE_FROM_ROW = 3;
const SKELETON_FADE_STEP = 0.25;
const SKELETON_ROW_STAGGER_MS = 90;
const MAX_UNREAD_BADGE_COUNT = 99;

type SectionTone = "online" | "offline";

const isRemoteImageUrl = (
  imageUrl: string | null | undefined
): imageUrl is string =>
  Boolean(imageUrl?.startsWith("http://") || imageUrl?.startsWith("https://"));

const getProcessedImageKey = (imageUrl: string, size: FriendImageSize) =>
  `${size.width}x${size.height}:${imageUrl}`;

const getFriendProvider = (friend: {
  id: string;
  provider?: StoreProvider;
}): StoreProvider => {
  if (friend.provider) return friend.provider;
  return friend.id.startsWith("epic:") ? "epic" : "steam";
};

const getFriendStatusText = (
  friend: UserFriend,
  onlineLabel: string,
  offlineLabel: string
) => {
  if (!friend.isOnline) return offlineLabel;
  if (friend.richPresence) return friend.richPresence;
  switch (friend.personaState) {
    case "away":
      return "Ausente";
    case "snooze":
      return "Inativo";
    case "busy":
      return "Ocupado";
    case "in-game":
      return "Em jogo";
    default:
      return onlineLabel;
  }
};

export default function FriendsWindow() {
  const { t } = useTranslation("friends_window");
  const { t: tProfile } = useTranslation("user_profile");
  const dispatch = useAppDispatch();
  const toast = useAppSelector((state) => state.toast);
  const { showSuccessToast, showErrorToast } = useToast();
  const handleToastClose = useCallback(() => {
    dispatch(closeToast());
  }, [dispatch]);

  const [accounts, setAccounts] = useState<StoreAccountsState | null>(null);
  const [systemUsername, setSystemUsername] = useState<string>("");
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequest[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(true);
  const [hasResolvedSnapshot, setHasResolvedSnapshot] = useState(false);
  const [chatUnread, setChatUnread] = useState<ChatUnreadState>({
    totalUnread: 0,
    byFriend: {},
  });

  const [filter, setFilter] = useState<SocialFriendsFilter>("all");
  const [search, setSearch] = useState("");
  const [isAddMode, setIsAddMode] = useState(false);
  const [addProvider, setAddProvider] = useState<StoreProvider>("steam");
  const [sentRequestsCollapsed, setSentRequestsCollapsed] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const [processedImages, setProcessedImages] = useState<
    Record<string, string>
  >({});

  // Invite popover state per friend
  const [inviteTargetFriend, setInviteTargetFriend] =
    useState<UserFriend | null>(null);
  const [invitableGames, setInvitableGames] = useState<SocialInvitableGame[]>(
    []
  );
  const [loadingInvitableGames, setLoadingInvitableGames] = useState(false);
  const [sendingInviteKey, setSendingInviteKey] = useState<string | null>(null);

  const { visibleFriendIds, observeFriendElement, isObservationSupported } =
    useVisibleFriendIds();
  const shouldLoadFriendImages = useCallback(
    (friendId: string) =>
      !isObservationSupported || visibleFriendIds.has(friendId),
    [isObservationSupported, visibleFriendIds]
  );

  const friendsRequestIdRef = useRef(0);

  const loadAccounts = useCallback(async () => {
    try {
      const next = await electron.storesGetAccounts();
      setAccounts(next);
      setAddProvider((prev) => {
        if (prev === "steam" && !next.steam.connected && next.epic.connected) {
          return "epic";
        }
        if (prev === "epic" && !next.epic.connected && next.steam.connected) {
          return "steam";
        }
        return prev;
      });
    } catch {
      // ignore
    }
  }, []);

  const fetchFriends = useCallback(async () => {
    const requestId = ++friendsRequestIdRef.current;

    try {
      const response = await electron.socialGetFriends();
      if (requestId === friendsRequestIdRef.current) {
        setFriends(response.friends);
        setFriendRequests(response.friendRequests);
      }
    } catch {
      // ignore transient errors; the next refresh will retry
    } finally {
      setIsLoadingFriends(false);
    }
  }, []);

  useEffect(() => {
    document.title = t("title");
  }, [t]);

  useEffect(() => {
    let cancelled = false;

    void electron
      .getSystemUsername()
      .then((name) => {
        if (!cancelled && name) setSystemUsername(name);
      })
      .catch(() => {});

    void loadAccounts();

    void electron
      .getChatUnreadState()
      .then((state) => {
        if (!cancelled) setChatUnread(state);
      })
      .catch(() => {});

    void electron
      .getFriendsSnapshot()
      .catch(() => null)
      .then((snapshot) => {
        if (cancelled) return;

        if (snapshot) {
          setFriends(snapshot.friends);
          setFriendRequests(snapshot.friendRequests);
          setIsLoadingFriends(false);
        }

        setHasResolvedSnapshot(true);
        void fetchFriends();
      });

    return () => {
      cancelled = true;
    };
  }, [loadAccounts, fetchFriends]);

  useEffect(() => {
    if (!hasResolvedSnapshot) return;
    const frame = requestAnimationFrame(() => electron.friendsWindowReady());
    return () => cancelAnimationFrame(frame);
  }, [hasResolvedSnapshot]);

  useEffect(() => {
    const unsubscribeUnread = electron.onChatUnreadUpdated(setChatUnread);
    const unsubscribeAccounts = electron.onStoreAccountsUpdated(() => {
      void loadAccounts();
      void fetchFriends();
    });
    const unsubscribeFriends = electron.onFriendsUpdated(() => {
      void fetchFriends();
    });
    const unsubscribePresence =
      typeof electron.onFriendPresence === "function"
        ? electron.onFriendPresence((presence) => {
            setFriends((prev) =>
              prev.map((friend) =>
                friend.id === presence.friendId
                  ? {
                      ...friend,
                      isOnline: presence.isOnline,
                      personaState:
                        presence.personaState ?? friend.personaState,
                      currentGame:
                        presence.currentGame !== undefined
                          ? presence.currentGame
                          : friend.currentGame,
                      richPresence:
                        presence.richPresence !== undefined
                          ? presence.richPresence
                          : friend.richPresence,
                      gameLobby:
                        presence.gameLobby !== undefined
                          ? presence.gameLobby
                          : friend.gameLobby,
                    }
                  : friend
              )
            );
          })
        : () => {};

    return () => {
      unsubscribeUnread();
      unsubscribeAccounts();
      unsubscribeFriends();
      unsubscribePresence();
    };
  }, [loadAccounts, fetchFriends]);

  const selfDisplayName =
    accounts?.steam.displayName ||
    accounts?.epic.displayName ||
    accounts?.steam.accountName ||
    accounts?.epic.accountName ||
    systemUsername ||
    "Cerberus";

  const selfAvatarUrl =
    accounts?.steam.avatarUrl || accounts?.epic.avatarUrl || null;

  const selfCopyValue =
    accounts?.steam.accountId || accounts?.epic.displayName || null;

  const hasAnyConnectedStore = Boolean(
    accounts?.steam.connected || accounts?.epic.connected
  );

  const filterCounts = useMemo(() => {
    let online = 0;
    let steam = 0;
    let epic = 0;
    for (const f of friends) {
      if (f.isOnline) online++;
      const p = getFriendProvider(f);
      if (p === "steam") steam++;
      else epic++;
    }
    return {
      all: friends.length,
      online,
      steam,
      epic,
    };
  }, [friends]);

  const filteredFriends = useMemo(() => {
    const q = search.trim().toLowerCase();
    return friends.filter((friend) => {
      const provider = getFriendProvider(friend);
      if (filter === "online" && !friend.isOnline) return false;
      if (filter === "steam" && provider !== "steam") return false;
      if (filter === "epic" && provider !== "epic") return false;
      if (q) {
        const matchName = friend.displayName.toLowerCase().includes(q);
        const matchGame = friend.currentGame?.title.toLowerCase().includes(q);
        if (!matchName && !matchGame) return false;
      }
      return true;
    });
  }, [friends, filter, search]);

  const sortedFriends = useMemo(
    () =>
      sortFriendsByUnreadMessages(
        filteredFriends,
        chatUnread.byFriend,
        chatUnread.lastMessageAtByFriend ?? {}
      ),
    [filteredFriends, chatUnread]
  );

  const onlineFriends = sortedFriends.filter((friend) => friend.isOnline);
  const offlineFriends =
    filter === "online"
      ? []
      : sortedFriends.filter((friend) => !friend.isOnline);

  const [onlineOverride, setOnlineOverride] = useState<boolean | null>(null);
  const [offlineOverride, setOfflineOverride] = useState<boolean | null>(null);
  const [requestsOverride, setRequestsOverride] = useState<boolean | null>(
    null
  );

  const onlineCollapsed = onlineOverride ?? onlineFriends.length === 0;
  const offlineCollapsed = offlineOverride ?? offlineFriends.length === 0;

  const receivedRequests = friendRequests.filter(
    (request) => request.type === "RECEIVED"
  );
  const sentRequests = friendRequests.filter(
    (request) => request.type === "SENT"
  );
  const requestsCollapsed = requestsOverride ?? receivedRequests.length === 0;

  useEffect(() => {
    if (typeof electron.getProcessedImage !== "function") return;

    const pendingImages = new Map<
      string,
      { imageUrl: string; size: FriendImageSize }
    >();

    const addImage = (
      imageUrl: string | null | undefined,
      size: FriendImageSize
    ) => {
      if (!isRemoteImageUrl(imageUrl)) return;
      const key = getProcessedImageKey(imageUrl, size);
      if (!processedImages[key]) {
        pendingImages.set(key, { imageUrl, size });
      }
    };

    addImage(selfAvatarUrl, PROFILE_AVATAR_IMAGE_SIZE);

    for (const friend of friends) {
      if (!shouldLoadFriendImages(friend.id)) continue;
      addImage(friend.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
      addImage(friend.backgroundImageUrl, BACKGROUND_IMAGE_SIZES.friend);
    }

    for (const request of friendRequests) {
      addImage(request.profileImageUrl, FRIEND_AVATAR_IMAGE_SIZE);
    }

    if (!pendingImages.size) return;

    let cancelled = false;

    const loadImages = async () => {
      const entries = [...pendingImages.entries()];
      for (
        let index = 0;
        index < entries.length;
        index += FRIEND_IMAGE_PROCESSING_BATCH_SIZE
      ) {
        const batch = entries.slice(
          index,
          index + FRIEND_IMAGE_PROCESSING_BATCH_SIZE
        );

        await Promise.all(
          batch.map(async ([key, { imageUrl, size }]) => {
            const processedImageUrl = await electron
              .getProcessedImage(imageUrl, {
                width: size.width,
                height: size.height,
                preserveAnimation: true,
              })
              .catch(() => imageUrl);

            if (cancelled) return;

            setProcessedImages((current) => {
              if (current[key] === processedImageUrl) return current;
              return {
                ...current,
                [key]: processedImageUrl ?? imageUrl,
              };
            });
          })
        );

        if (cancelled) return;
      }
    };

    void loadImages();

    return () => {
      cancelled = true;
    };
  }, [
    friends,
    friendRequests,
    selfAvatarUrl,
    processedImages,
    shouldLoadFriendImages,
  ]);

  const getProcessedImageUrl = (
    imageUrl: string | null | undefined,
    size: FriendImageSize
  ) => {
    if (!imageUrl) return imageUrl;

    const processedImageUrl =
      processedImages[getProcessedImageKey(imageUrl, size)];
    if (processedImageUrl) return processedImageUrl;

    const canProcessImages = typeof electron.getProcessedImage === "function";
    return canProcessImages && isRemoteImageUrl(imageUrl)
      ? undefined
      : imageUrl;
  };

  const selfGame = useAppSelector((state) => state.gameRunning.gameRunning);

  const handleCopyFriendCode = () => {
    if (!selfCopyValue) return;
    navigator.clipboard.writeText(selfCopyValue);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), COPIED_FEEDBACK_MS);
  };

  const handleMessageFriend = (friend: UserFriend) => {
    void electron.openChatWindow(friend);
  };

  const handleJoinFriendLobby = async (friend: UserFriend) => {
    const provider = getFriendProvider(friend);
    const invite: SocialGameInvite = {
      id: `lobby-${friend.id}-${Date.now()}`,
      provider,
      appId: friend.currentGame?.objectId ?? friend.gameLobby?.appId,
      gameTitle: friend.currentGame?.title || "Jogo",
      lobbyId: friend.gameLobby?.lobbyId,
      connectString: friend.gameLobby?.connectString,
      partyId: friend.gameLobby?.partyId,
      inviterId: friend.id,
      createdAt: new Date().toISOString(),
    };

    try {
      const res = await electron.socialAcceptGameInvite(invite);
      if (res.launched) {
        showSuccessToast(`Abrindo ${invite.gameTitle}...`);
      } else if (res.navigatedTo) {
        showErrorToast(
          `${invite.gameTitle} não está instalado neste dispositivo.`
        );
      } else {
        showErrorToast(
          `Não foi possível localizar ${invite.gameTitle} na biblioteca.`
        );
      }
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Erro ao entrar no jogo."
      );
    }
  };

  const handleToggleInvitePicker = async (friend: UserFriend) => {
    if (inviteTargetFriend?.id === friend.id) {
      setInviteTargetFriend(null);
      return;
    }

    setInviteTargetFriend(friend);
    setLoadingInvitableGames(true);
    setInvitableGames([]);

    try {
      const provider = getFriendProvider(friend);
      const games = await electron.socialGetInvitableGames(provider);
      setInvitableGames(games);
    } catch {
      setInvitableGames([]);
    } finally {
      setLoadingInvitableGames(false);
    }
  };

  const handleSendGameInvite = async (
    friend: UserFriend,
    game: SocialInvitableGame
  ) => {
    const key = `${friend.id}:${game.shop}:${game.objectId}`;
    setSendingInviteKey(key);
    try {
      await electron.socialSendGameInvite({
        friendId: friend.id,
        gameShop: game.shop,
        objectId: game.objectId,
        gameTitle: game.title,
      });
      showSuccessToast(`Convite de ${game.title} enviado para ${friend.displayName}.`);
      setInviteTargetFriend(null);
    } catch (err) {
      showErrorToast(
        err instanceof Error ? err.message : "Falha ao enviar convite."
      );
    } finally {
      setSendingInviteKey(null);
    }
  };

  const handleCopyCerberusInvite = (game: SocialInvitableGame) => {
    const link = buildCerberusInviteUrl({
      shop: game.shop,
      objectId: game.objectId,
      title: game.title,
    });
    navigator.clipboard
      .writeText(link)
      .then(() => {
        showSuccessToast("Link de convite Cerberus copiado!");
        setInviteTargetFriend(null);
      })
      .catch(() => {});
  };

  const friendIds = useMemo(
    () => new Set(friends.map((friend) => friend.id)),
    [friends]
  );

  const addFriend = useAddFriend({
    provider: addProvider,
    isFriend: (userId) => friendIds.has(userId),
    onSuccess: () => {
      void fetchFriends();
    },
  });

  const searchFieldValue = isAddMode ? addFriend.friendCode : search;

  const handleSearchFieldChange = (value: string) => {
    if (isAddMode) addFriend.changeFriendCode(value);
    else setSearch(value);
  };

  const handleToggleAddMode = () => {
    setIsAddMode((current) => !current);
    addFriend.changeFriendCode("");
    setSearch("");
    searchInputRef.current?.focus();
  };

  useEffect(() => {
    const openAddMode = () => {
      if (!consumeAddFriendRequest()) return;
      setIsAddMode(true);
      setSearch("");
      searchInputRef.current?.focus();
    };

    openAddMode();
    globalThis.addEventListener("storage", openAddMode);
    return () => globalThis.removeEventListener("storage", openAddMode);
  }, []);

  const handleSearchFieldKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (!isAddMode) return;

    if (event.key === "Enter") {
      event.preventDefault();
      void addFriend.sendRequest();
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleToggleAddMode();
    }
  };

  const handleAcceptRequest = (userId: string) => {
    void electron
      .socialRespondFriendRequest(userId, true)
      .then(() => fetchFriends())
      .catch((err) => {
        showErrorToast(
          err instanceof Error ? err.message : "Falha ao aceitar solicitação."
        );
      });
  };

  const handleRefuseRequest = (userId: string) => {
    void electron
      .socialRespondFriendRequest(userId, false)
      .then(() => fetchFriends())
      .catch(() => {});
  };

  const getGameIcon = (game: { iconUrl: string | null; title: string }) => {
    if (game.iconUrl) {
      return (
        <img
          className="friends-window__game-icon"
          alt={game.title}
          width={16}
          height={16}
          src={game.iconUrl}
        />
      );
    }

    return <SteamLogo width={16} height={16} />;
  };

  const renderProviderBadge = (provider: StoreProvider) => (
    <span
      className={`friends-window__provider-badge friends-window__provider-badge--${provider}`}
      title={provider === "steam" ? "Steam" : "Epic Games"}
    >
      {provider === "steam" ? (
        <SteamLogo width={11} height={11} />
      ) : (
        <EpicLogo width={11} height={11} />
      )}
    </span>
  );

  const renderRequest = (request: FriendRequest, actions: React.ReactNode) => {
    const provider = getFriendProvider(request);

    return (
      <li key={request.id} className="friends-window__friend">
        <div className="friends-window__friend-button">
          <div className="friends-window__avatar-wrapper">
            <Avatar
              size={40}
              src={getProcessedImageUrl(
                request.profileImageUrl,
                FRIEND_AVATAR_IMAGE_SIZE
              )}
              alt={request.displayName}
            />
          </div>
          <div className="friends-window__friend-details">
            <span className="friends-window__friend-name-row">
              <span className="friends-window__friend-name">
                {request.displayName}
              </span>
              {renderProviderBadge(provider)}
            </span>
          </div>
        </div>
        <div className="friends-window__request-actions">{actions}</div>
      </li>
    );
  };

  const getMessageLabel = (friend: UserFriend, unreadCount: number) => {
    const messageFriendLabel = t("message_friend", {
      name: friend.displayName,
    });
    if (unreadCount === 0) return messageFriendLabel;

    const unreadLabel = t("unread_messages", { count: unreadCount });
    return `${messageFriendLabel}, ${unreadLabel}`;
  };

  const renderMessageButton = (friend: UserFriend) => {
    const unreadCount = chatUnread.byFriend[friend.id] ?? 0;
    const messageLabel = getMessageLabel(friend, unreadCount);

    return (
      <button
        type="button"
        className={`friends-window__message-button${
          unreadCount > 0 ? " friends-window__message-button--unread" : ""
        }`}
        onClick={() => handleMessageFriend(friend)}
        title={messageLabel}
        aria-label={messageLabel}
      >
        <CommentIcon size={16} />
        {unreadCount > 0 && (
          <span className="friends-window__unread-badge" aria-hidden="true">
            <span className="friends-window__badge-value">
              {unreadCount > MAX_UNREAD_BADGE_COUNT
                ? `${MAX_UNREAD_BADGE_COUNT}+`
                : unreadCount}
            </span>
          </span>
        )}
      </button>
    );
  };

  const renderFriend = (friend: UserFriend) => {
    const backgroundImageUrl = getProcessedImageUrl(
      friend.backgroundImageUrl,
      BACKGROUND_IMAGE_SIZES.friend
    );
    const provider = getFriendProvider(friend);
    const isInviteOpen = inviteTargetFriend?.id === friend.id;
    const statusText = getFriendStatusText(friend, t("online"), t("offline"));

    return (
      <li
        key={friend.id}
        ref={observeFriendElement(friend.id)}
        data-friend-id={friend.id}
        className={`friends-window__friend${
          backgroundImageUrl ? " friends-window__friend--has-bg" : ""
        }${isInviteOpen ? " friends-window__friend--invite-open" : ""}`}
      >
        <div className="friends-window__friend-row">
          {backgroundImageUrl && (
            <img
              src={backgroundImageUrl}
              alt=""
              loading="lazy"
              decoding="async"
              className="friends-window__friend-bg"
            />
          )}
          <button
            type="button"
            className="friends-window__friend-button"
            onClick={() => handleMessageFriend(friend)}
            title={
              friend.currentGame
                ? t("playing", { game: friend.currentGame.title })
                : undefined
            }
          >
            <div className="friends-window__avatar-wrapper">
              <Avatar
                size={40}
                src={getProcessedImageUrl(
                  friend.profileImageUrl,
                  FRIEND_AVATAR_IMAGE_SIZE
                )}
                alt={friend.displayName}
                loading="lazy"
                decoding="async"
              />
              <span
                className={`friends-window__status-orb${
                  friend.isOnline ? " friends-window__status-orb--online" : ""
                }${
                  friend.personaState === "away" ||
                  friend.personaState === "snooze"
                    ? " friends-window__status-orb--away"
                    : ""
                }`}
              />
            </div>

            <div className="friends-window__friend-details">
              <span className="friends-window__friend-name-row">
                <span className="friends-window__friend-name">
                  {friend.displayName}
                </span>
                {renderProviderBadge(provider)}
              </span>
              {friend.currentGame ? (
                <div className="friends-window__game-info">
                  {getGameIcon(friend.currentGame)}
                  <small>
                    {friend.currentGame.title}
                    {friend.richPresence &&
                    friend.richPresence !== friend.currentGame.title
                      ? ` — ${friend.richPresence}`
                      : ""}
                  </small>
                </div>
              ) : (
                <small className="friends-window__friend-status">
                  {statusText}
                </small>
              )}
            </div>
          </button>

          <div className="friends-window__friend-actions">
            {friend.gameLobby?.joinable && (
              <button
                type="button"
                className="friends-window__join-button"
                onClick={() => void handleJoinFriendLobby(friend)}
                title={`Entrar no jogo de ${friend.displayName}`}
              >
                <Play size={12} />
                <span>Entrar</span>
              </button>
            )}

            <button
              type="button"
              className={`friends-window__invite-button${
                isInviteOpen ? " friends-window__invite-button--active" : ""
              }`}
              onClick={() => void handleToggleInvitePicker(friend)}
              title="Chamar para jogar"
              aria-label={`Chamar ${friend.displayName} para jogar`}
            >
              <Gamepad2 size={16} />
            </button>

            {renderMessageButton(friend)}
          </div>
        </div>

        {isInviteOpen && (
          <div className="friends-window__invite-picker">
            <div className="friends-window__invite-picker-header">
              <span>Chamar {friend.displayName} para jogar</span>
              <button
                type="button"
                onClick={() => setInviteTargetFriend(null)}
                aria-label="Fechar convite"
              >
                <XIcon size={14} />
              </button>
            </div>
            {loadingInvitableGames ? (
              <p className="friends-window__invite-picker-empty">
                Carregando jogos disponíveis...
              </p>
            ) : invitableGames.length === 0 ? (
              <div className="friends-window__invite-picker-empty">
                {selfGame ? (
                  <button
                    type="button"
                    className="friends-window__invite-game-item"
                    onClick={() =>
                      void handleSendGameInvite(friend, {
                        objectId: selfGame.objectId,
                        shop: selfGame.shop,
                        title: selfGame.title,
                        iconUrl: selfGame.iconUrl,
                        isInstalled: true,
                      })
                    }
                  >
                    <span>Convidar para {selfGame.title}</span>
                  </button>
                ) : (
                  <span>
                    Nenhum jogo {provider === "steam" ? "Steam" : "Epic"} na
                    biblioteca ainda. Sincronize em Configurações → Integrações.
                  </span>
                )}
              </div>
            ) : (
              <div className="friends-window__invite-game-list">
                {invitableGames.slice(0, 12).map((game) => {
                  const key = `${friend.id}:${game.shop}:${game.objectId}`;
                  const busy = sendingInviteKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={busy}
                      className="friends-window__invite-game-item"
                      onClick={() => void handleSendGameInvite(friend, game)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        handleCopyCerberusInvite(game);
                      }}
                      title="Clique para convidar na loja. Botão direito para copiar link Cerberus."
                    >
                      <span className="friends-window__invite-game-title">
                        {game.title}
                      </span>
                      <span className="friends-window__invite-game-tag">
                        {busy
                          ? "Enviando..."
                          : game.isInstalled
                            ? "Instalado"
                            : "Biblioteca"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </li>
    );
  };

  const renderCount = (count: number, tone?: SectionTone) => (
    <span
      className={`friends-window__count${
        tone ? ` friends-window__count--${tone}` : ""
      }`}
    >
      <span className="friends-window__badge-value">{count}</span>
    </span>
  );

  const renderSectionHeader = (
    title: string,
    count: number,
    collapsed: boolean,
    onToggle: () => void,
    tone?: SectionTone
  ) => (
    <button
      type="button"
      className="friends-window__section-header"
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      {collapsed ? (
        <ChevronRightIcon size={16} />
      ) : (
        <ChevronDownIcon size={16} />
      )}
      <span className="friends-window__section-title">{title}</span>
      {renderCount(count, tone)}
    </button>
  );

  const renderCollapsibleSection = (
    title: string,
    count: number,
    list: UserFriend[],
    collapsed: boolean,
    onToggle: () => void,
    emptyText: string,
    tone: SectionTone
  ) => (
    <section className="friends-window__section">
      {renderSectionHeader(title, count, collapsed, onToggle, tone)}

      {!collapsed &&
        (list.length > 0 ? (
          <ul className="friends-window__list">{list.map(renderFriend)}</ul>
        ) : (
          <p className="friends-window__empty">{emptyText}</p>
        ))}
    </section>
  );

  const renderSkeletonSection = (
    title: string,
    rows: number[][],
    firstRowIndex: number,
    fadeFromRow?: number
  ) => (
    <section className="friends-window__section">
      <div className="friends-window__section-header friends-window__section-header--static">
        <ChevronDownIcon size={16} />
        <span className="friends-window__section-title">{title}</span>
        <span className="friends-window__skeleton friends-window__skeleton--count" />
      </div>

      <ul className="friends-window__list">
        {rows.map(([nameWidth, statusWidth], index) => {
          const fadeSteps =
            fadeFromRow === undefined ? 0 : index - fadeFromRow + 1;

          return (
            <li
              key={`${firstRowIndex + index}`}
              className="friends-window__skeleton-row"
              style={
                {
                  "--skeleton-delay": `${
                    (firstRowIndex + index) * SKELETON_ROW_STAGGER_MS
                  }ms`,
                  opacity:
                    fadeSteps > 0
                      ? 1 - fadeSteps * SKELETON_FADE_STEP
                      : undefined,
                } as React.CSSProperties
              }
            >
              <span className="friends-window__skeleton friends-window__skeleton--avatar" />
              <span className="friends-window__skeleton-details">
                <span
                  className="friends-window__skeleton friends-window__skeleton--name"
                  style={{ width: nameWidth }}
                />
                <span
                  className="friends-window__skeleton friends-window__skeleton--status"
                  style={{ width: statusWidth }}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );

  const renderFilterTabs = () => (
    <div
      className="friends-window__filters"
      role="tablist"
      aria-label="Filtrar amigos"
    >
      {(
        [
          { id: "all", label: "Todos", count: filterCounts.all },
          { id: "online", label: "Online", count: filterCounts.online },
          { id: "steam", label: "Steam", count: filterCounts.steam },
          { id: "epic", label: "Epic", count: filterCounts.epic },
        ] as const
      ).map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={filter === tab.id}
          className={`friends-window__filter-tab${
            filter === tab.id ? " friends-window__filter-tab--active" : ""
          }`}
          onClick={() => setFilter(tab.id)}
        >
          {tab.id === "steam" && <SteamLogo width={12} height={12} />}
          {tab.id === "epic" && <EpicLogo width={12} height={12} />}
          <span>{tab.label}</span>
          <span className="friends-window__filter-count">{tab.count}</span>
        </button>
      ))}
    </div>
  );

  const renderSearchControls = () => {
    const searchPlaceholder = isAddMode
      ? addProvider === "steam"
        ? "SteamID64, código ou link do perfil"
        : "Nome de exibição na Epic Games"
      : t("search_placeholder");
    const addFriendToggleLabel = isAddMode ? t("close") : t("add_friend");

    return (
      <>
        <div className="friends-window__search-row">
          <div
            className={`friends-window__search${
              isAddMode ? " friends-window__search--add" : ""
            }`}
          >
            {isAddMode ? (
              <PersonAddIcon
                size={16}
                className="friends-window__search-icon"
              />
            ) : (
              <SearchIcon size={16} className="friends-window__search-icon" />
            )}
            <input
              ref={searchInputRef}
              type="text"
              value={searchFieldValue}
              spellCheck={false}
              onChange={(event) => handleSearchFieldChange(event.target.value)}
              onKeyDown={handleSearchFieldKeyDown}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="friends-window__search-input"
            />
            {searchFieldValue && (
              <button
                type="button"
                className="friends-window__search-clear"
                onClick={() => handleSearchFieldChange("")}
                title={t("clear_search")}
                aria-label={t("clear_search")}
              >
                <XIcon size={16} />
              </button>
            )}
          </div>
          <Button
            theme="primary"
            className={`friends-window__add-friend${
              isAddMode ? " friends-window__add-friend--active" : ""
            }`}
            onClick={handleToggleAddMode}
            title={addFriendToggleLabel}
            aria-label={addFriendToggleLabel}
            aria-expanded={isAddMode}
          >
            <span
              className="friends-window__add-friend-face friends-window__add-friend-face--add"
              aria-hidden="true"
            >
              <PersonAddIcon size={16} />
            </span>
            <span
              className="friends-window__add-friend-face friends-window__add-friend-face--close"
              aria-hidden="true"
            >
              <XIcon size={16} />
            </span>
          </Button>
        </div>

        {isAddMode && (
          <div className="friends-window__add-panel">
            <div className="friends-window__add-providers">
              <button
                type="button"
                className={`friends-window__filter-tab${
                  addProvider === "steam"
                    ? " friends-window__filter-tab--active"
                    : ""
                }`}
                onClick={() => setAddProvider("steam")}
              >
                <SteamLogo width={12} height={12} />
                <span>Steam</span>
              </button>
              <button
                type="button"
                className={`friends-window__filter-tab${
                  addProvider === "epic"
                    ? " friends-window__filter-tab--active"
                    : ""
                }`}
                onClick={() => setAddProvider("epic")}
              >
                <EpicLogo width={12} height={12} />
                <span>Epic Games</span>
              </button>
            </div>
            <div className="friends-window__add-actions">
              <Button
                theme="primary"
                disabled={addFriend.isSending}
                onClick={() => void addFriend.sendRequest()}
              >
                <PersonAddIcon size={16} />
                {addFriend.isSending
                  ? tProfile("sending")
                  : t("send_friend_request")}
              </Button>
            </div>
          </div>
        )}
      </>
    );
  };

  const showSkeleton = isLoadingFriends && friends.length === 0;

  return (
    <div className="friends-window">
      <div className="friends-window__header">
        {!electron.hasNativeWindowDecorations && (
          <header className="friends-window__title-bar">
            <h4>{t("title")}</h4>
            <div className="friends-window__window-controls">
              <button
                type="button"
                className="friends-window__window-control"
                onClick={() => electron.minimizeFriendsWindow()}
                title={t("minimize")}
                aria-label={t("minimize")}
              >
                <DashIcon size={16} />
              </button>
              <button
                type="button"
                className="friends-window__window-control friends-window__window-control--close"
                onClick={() => electron.closeFriendsWindow()}
                title={t("close")}
                aria-label={t("close")}
              >
                <XIcon size={16} />
              </button>
            </div>
          </header>
        )}

        <section className="friends-window__profile">
          <div className="friends-window__profile-content">
            <div className="friends-window__profile-avatar">
              <div className="friends-window__avatar-wrapper">
                <Avatar
                  size={56}
                  src={getProcessedImageUrl(
                    selfAvatarUrl,
                    PROFILE_AVATAR_IMAGE_SIZE
                  )}
                  alt={selfDisplayName}
                />
                <span
                  className={`friends-window__status-orb friends-window__status-orb--profile${
                    hasAnyConnectedStore ? " friends-window__status-orb--online" : ""
                  }`}
                />
              </div>
            </div>
            <div className="friends-window__profile-info">
              <div className="friends-window__profile-name-row">
                <span className="friends-window__profile-name">
                  {selfDisplayName}
                </span>
                {selfCopyValue && (
                  <button
                    type="button"
                    className={`friends-window__friend-code${
                      isCopied ? " friends-window__friend-code--copied" : ""
                    }`}
                    onClick={handleCopyFriendCode}
                    title={t("copy_friend_code")}
                  >
                    <span className="friends-window__friend-code-value">
                      {isCopied ? t("copied") : selfCopyValue}
                    </span>
                    <CopyIcon size={14} />
                  </button>
                )}
              </div>

              {selfGame ? (
                <div className="friends-window__profile-game">
                  {getGameIcon({
                    iconUrl: selfGame.iconUrl,
                    title: selfGame.title,
                  })}
                  <small>{selfGame.title}</small>
                </div>
              ) : (
                <div className="friends-window__store-pills">
                  <span
                    className={`friends-window__store-pill${
                      accounts?.steam.connected
                        ? " friends-window__store-pill--connected"
                        : ""
                    }`}
                  >
                    <SteamLogo width={11} height={11} />
                    <span>
                      {accounts?.steam.connected ? "Steam OK" : "Steam off"}
                    </span>
                  </span>
                  <span
                    className={`friends-window__store-pill${
                      accounts?.epic.connected
                        ? " friends-window__store-pill--connected"
                        : ""
                    }`}
                  >
                    <EpicLogo width={11} height={11} />
                    <span>
                      {accounts?.epic.connected ? "Epic OK" : "Epic off"}
                    </span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>

      <div className="friends-window__content">
        {renderSearchControls()}
        {renderFilterTabs()}

        <div
          className="friends-window__list-container"
          aria-busy={showSkeleton}
        >
          {!hasAnyConnectedStore && !showSkeleton && friends.length === 0 ? (
            <div className="friends-window__connect-cta">
              <p>
                Conecte sua conta <strong>Steam</strong> ou{" "}
                <strong>Epic Games</strong> em{" "}
                <strong>Configurações → Integrações</strong> para sincronizar
                seus amigos, presença ao vivo, chat e convites de jogo.
              </p>
              <Button
                theme="outline"
                onClick={() => void electron.openMainWindow()}
              >
                Abrir janela principal
              </Button>
            </div>
          ) : showSkeleton ? (
            <>
              {renderSkeletonSection(t("online"), ONLINE_SKELETON_ROWS, 0)}
              {renderSkeletonSection(
                t("offline"),
                OFFLINE_SKELETON_ROWS,
                ONLINE_SKELETON_ROWS.length,
                SKELETON_FADE_FROM_ROW
              )}
            </>
          ) : (
            <>
              {isAddMode && sentRequests.length > 0 && (
                <section className="friends-window__section">
                  {renderSectionHeader(
                    tProfile("pending"),
                    sentRequests.length,
                    sentRequestsCollapsed,
                    () => setSentRequestsCollapsed((collapsed) => !collapsed)
                  )}

                  {!sentRequestsCollapsed && (
                    <ul className="friends-window__list">
                      {sentRequests.map((request) =>
                        renderRequest(
                          request,
                          <button
                            type="button"
                            className="friends-window__request-action friends-window__request-action--refuse"
                            onClick={() =>
                              addFriend.cancelSentRequest(request.id)
                            }
                            title={tProfile("cancel_request")}
                            aria-label={tProfile("cancel_request")}
                          >
                            <XIcon size={16} />
                          </button>
                        )
                      )}
                    </ul>
                  )}
                </section>
              )}

              {receivedRequests.length > 0 && (
                <section className="friends-window__section">
                  {renderSectionHeader(
                    t("friend_requests"),
                    receivedRequests.length,
                    requestsCollapsed,
                    () => setRequestsOverride(!requestsCollapsed)
                  )}

                  {!requestsCollapsed && (
                    <ul className="friends-window__list">
                      {receivedRequests.map((request) =>
                        renderRequest(
                          request,
                          <>
                            <button
                              type="button"
                              className="friends-window__request-action friends-window__request-action--accept"
                              onClick={() => handleAcceptRequest(request.id)}
                              title={t("accept")}
                            >
                              <CheckIcon size={16} />
                            </button>
                            <button
                              type="button"
                              className="friends-window__request-action friends-window__request-action--refuse"
                              onClick={() => handleRefuseRequest(request.id)}
                              title={t("refuse")}
                            >
                              <XIcon size={16} />
                            </button>
                          </>
                        )
                      )}
                    </ul>
                  )}
                </section>
              )}

              {renderCollapsibleSection(
                t("online"),
                onlineFriends.length,
                onlineFriends,
                onlineCollapsed,
                () => setOnlineOverride(!onlineCollapsed),
                search.trim() ? t("no_results") : t("no_friends"),
                "online"
              )}

              {filter !== "online" &&
                offlineFriends.length > 0 &&
                renderCollapsibleSection(
                  t("offline"),
                  offlineFriends.length,
                  offlineFriends,
                  offlineCollapsed,
                  () => setOfflineOverride(!offlineCollapsed),
                  t("no_results"),
                  "offline"
                )}
            </>
          )}
        </div>
      </div>

      <Toast
        visible={toast.visible}
        title={toast.title}
        message={toast.message}
        type={toast.type}
        duration={toast.duration}
        onClose={handleToastClose}
      />
    </div>
  );
}
