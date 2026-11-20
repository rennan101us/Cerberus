import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GameControllerIcon,
  PaperPlaneTiltIcon,
  PlayIcon,
} from "@phosphor-icons/react";
import cn from "classnames";

import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import type {
  ChatMessageDto,
  ChatUnreadState,
  SocialFriendsFilter,
  SocialGameInvite,
  SocialInvitableGame,
  StoreAccountsState,
  StoreProvider,
  UserFriend,
} from "@types";

import {
  Button,
  FocusItem,
  HorizontalFocusGroup,
  Input,
  ScrollArea,
  VerticalFocusGroup,
} from "../../components";
import { getItemFocusTarget } from "../../helpers";
import { useBigPictureToast } from "../../hooks";
import { BIG_PICTURE_SIDEBAR_ITEM_IDS } from "../../layout/navigation";
import {
  FRIENDS_CHAT_INPUT_ID,
  FRIENDS_CHAT_REGION_ID,
  FRIENDS_CHAT_SEND_ID,
  FRIENDS_EMPTY_SETTINGS_BUTTON_ID,
  FRIENDS_FILTERS_REGION_ID,
  FRIENDS_INVITE_BUTTON_ID,
  FRIENDS_JOIN_BUTTON_ID,
  FRIENDS_LIST_REGION_ID,
  FRIENDS_PAGE_REGION_ID,
  getFriendsFilterFocusId,
  getFriendsRowFocusId,
} from "./navigation";
import "./friends.scss";

const electron = globalThis.window.electron;

const getFriendProvider = (friend: UserFriend): StoreProvider =>
  friend.provider ?? (friend.id.startsWith("epic:") ? "epic" : "steam");

export default function Friends() {
  const navigate = useNavigate();
  const { showErrorToast, showSuccessToast } = useBigPictureToast();

  const [accounts, setAccounts] = useState<StoreAccountsState | null>(null);
  const [friends, setFriends] = useState<UserFriend[]>([]);
  const [unread, setUnread] = useState<ChatUnreadState>({
    totalUnread: 0,
    byFriend: {},
  });
  const [filter, setFilter] = useState<SocialFriendsFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessageDto[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const [showInvitePicker, setShowInvitePicker] = useState(false);
  const [invitableGames, setInvitableGames] = useState<SocialInvitableGame[]>(
    []
  );
  const [loadingGames, setLoadingGames] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [acc, snap, unreadState] = await Promise.all([
        electron.storesGetAccounts(),
        electron.socialGetFriends(),
        electron.getChatUnreadState().catch(() => ({
          totalUnread: 0,
          byFriend: {},
        })),
      ]);
      setAccounts(acc);
      setFriends(snap.friends);
      setUnread(unreadState);
      setSelectedId((prev) => prev ?? snap.friends[0]?.id ?? null);
    } catch {
      // ignore transient startup failures
    }
  }, []);

  useEffect(() => {
    void loadData();
    const unsubAcc = electron.onStoreAccountsUpdated(() => void loadData());
    const unsubFriends = electron.onFriendsUpdated(() => void loadData());
    const unsubUnread = electron.onChatUnreadUpdated(setUnread);
    const unsubPresence = electron.onFriendPresence((presence) => {
      setFriends((prev) =>
        prev.map((friend) =>
          friend.id === presence.friendId
            ? {
                ...friend,
                isOnline: presence.isOnline,
                personaState: presence.personaState ?? friend.personaState,
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
    });

    return () => {
      unsubAcc();
      unsubFriends();
      unsubUnread();
      unsubPresence();
    };
  }, [loadData]);

  const filteredFriends = useMemo(() => {
    return friends.filter((friend) => {
      const provider = getFriendProvider(friend);
      if (filter === "online") return Boolean(friend.isOnline);
      if (filter === "steam") return provider === "steam";
      if (filter === "epic") return provider === "epic";
      return true;
    });
  }, [friends, filter]);

  const selectedFriend =
    friends.find((friend) => friend.id === selectedId) ??
    filteredFriends[0] ??
    null;

  useEffect(() => {
    if (!selectedFriend) {
      setMessages([]);
      return;
    }

    let cancelled = false;
    setShowInvitePicker(false);

    void electron
      .socialGetMessages(selectedFriend.id, { take: 50 })
      .then((page) => {
        if (!cancelled) setMessages(page.messages);
      })
      .catch(() => {
        if (!cancelled) setMessages([]);
      });

    void electron.socialMarkRead(selectedFriend.id).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [selectedFriend?.id]);

  useEffect(() => {
    return electron.onChatMessage(({ friendId, message }) => {
      if (friendId !== selectedFriend?.id) return;
      setMessages((prev) => {
        if (
          prev.some(
            (existing) =>
              existing.seq === message.seq ||
              existing.clientNonce === message.clientNonce
          )
        ) {
          return prev;
        }
        return [...prev, message];
      });
      void electron.socialMarkRead(friendId).catch(() => {});
    });
  }, [selectedFriend?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, selectedFriend?.id]);

  const handleSend = async () => {
    if (!selectedFriend || sending) return;
    const body = draft.trim();
    if (!body) return;

    setSending(true);
    try {
      await electron.socialSendMessage(selectedFriend.id, body);
      setDraft("");
    } catch (err) {
      showErrorToast("Erro ao enviar mensagem", {
        message: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSending(false);
    }
  };

  const handleToggleInvitePicker = async () => {
    if (!selectedFriend) return;
    if (showInvitePicker) {
      setShowInvitePicker(false);
      return;
    }
    setShowInvitePicker(true);
    setLoadingGames(true);
    try {
      const games = await electron.socialGetInvitableGames(
        getFriendProvider(selectedFriend)
      );
      setInvitableGames(games);
    } catch {
      setInvitableGames([]);
    } finally {
      setLoadingGames(false);
    }
  };

  const handleInviteGame = async (game: SocialInvitableGame) => {
    if (!selectedFriend) return;
    try {
      await electron.socialSendGameInvite({
        friendId: selectedFriend.id,
        gameShop: game.shop,
        objectId: game.objectId,
        gameTitle: game.title,
      });
      setShowInvitePicker(false);
      showSuccessToast(`Convite enviado para ${selectedFriend.displayName}`, {
        message: game.title,
      });
    } catch (err) {
      showErrorToast("Erro ao enviar convite", {
        message: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleAcceptInvite = async (invite: SocialGameInvite) => {
    try {
      const res = await electron.socialAcceptGameInvite(invite);
      if (res.launched) {
        showSuccessToast(`Abrindo ${invite.gameTitle}...`);
      } else {
        showErrorToast("Jogo não instalado neste dispositivo");
      }
    } catch (err) {
      showErrorToast("Falha ao aceitar convite", {
        message: err instanceof Error ? err.message : undefined,
      });
    }
  };

  const handleJoinSelectedLobby = async () => {
    if (!selectedFriend) return;
    await handleAcceptInvite({
      id: `lobby-${selectedFriend.id}-${Date.now()}`,
      provider: getFriendProvider(selectedFriend),
      appId:
        selectedFriend.currentGame?.objectId ?? selectedFriend.gameLobby?.appId,
      gameTitle: selectedFriend.currentGame?.title || "Jogo",
      lobbyId: selectedFriend.gameLobby?.lobbyId,
      connectString: selectedFriend.gameLobby?.connectString,
      partyId: selectedFriend.gameLobby?.partyId,
      inviterId: selectedFriend.id,
      createdAt: new Date().toISOString(),
    });
  };

  const hasAnyAccount = Boolean(
    accounts?.steam.connected || accounts?.epic.connected
  );

  const sidebarTarget = getItemFocusTarget(
    BIG_PICTURE_SIDEBAR_ITEM_IDS.friends
  );

  return (
    <VerticalFocusGroup
      regionId={FRIENDS_PAGE_REGION_ID}
      navigationOverrides={{ left: sidebarTarget }}
      className="bp-friends"
    >
      <div className="bp-friends__header">
        <div className="bp-friends__title-block">
          <h1>Amigos Steam &amp; Epic</h1>
          <p>Chat unificado, presença ao vivo e convites para jogar</p>
        </div>

        <HorizontalFocusGroup
          regionId={FRIENDS_FILTERS_REGION_ID}
          navigationOverrides={{ left: sidebarTarget }}
          className="bp-friends__filters"
        >
          {(
            [
              { id: "all", label: "Todos" },
              { id: "online", label: "Online" },
              { id: "steam", label: "Steam" },
              { id: "epic", label: "Epic" },
            ] as const
          ).map((tab) => (
            <FocusItem
              key={tab.id}
              id={getFriendsFilterFocusId(tab.id)}
              actions={{ primary: () => setFilter(tab.id) }}
              asChild
            >
              <button
                type="button"
                className={cn("bp-friends__filter-pill", {
                  "bp-friends__filter-pill--active": filter === tab.id,
                })}
                onClick={() => setFilter(tab.id)}
              >
                {tab.id === "steam" && <SteamLogo width={13} height={13} />}
                {tab.id === "epic" && <EpicLogo width={13} height={13} />}
                <span>{tab.label}</span>
              </button>
            </FocusItem>
          ))}
        </HorizontalFocusGroup>
      </div>

      {!hasAnyAccount && friends.length === 0 ? (
        <div className="bp-friends__empty-card">
          <h2>Nenhuma conta de loja conectada</h2>
          <p>
            Conecte sua conta Steam ou Epic Games em Configurações → Integrações
            no modo desktop para ver seus amigos, conversar e enviar convites
            aqui pelo controle.
          </p>
          <Button
            focusId={FRIENDS_EMPTY_SETTINGS_BUTTON_ID}
            focusNavigationOverrides={{ left: sidebarTarget }}
            onClick={() => navigate("/settings?tab=integrations")}
          >
            Ir para Configurações
          </Button>
        </div>
      ) : (
        <div className="bp-friends__grid">
          <VerticalFocusGroup
            regionId={FRIENDS_LIST_REGION_ID}
            navigationOverrides={{ left: sidebarTarget }}
            className="bp-friends__list-panel"
          >
            <ScrollArea showScrollbar className="bp-friends__list-scroll">
              {filteredFriends.length === 0 ? (
                <div className="bp-friends__placeholder">
                  Nenhum amigo encontrado neste filtro.
                </div>
              ) : (
                filteredFriends.map((friend) => {
                  const provider = getFriendProvider(friend);
                  const unreadCount = unread.byFriend[friend.id] ?? 0;
                  const active = selectedFriend?.id === friend.id;
                  return (
                    <FocusItem
                      key={friend.id}
                      id={getFriendsRowFocusId(friend.id)}
                      actions={{ primary: () => setSelectedId(friend.id) }}
                      asChild
                    >
                      <button
                        type="button"
                        className={cn("bp-friends__friend-row", {
                          "bp-friends__friend-row--active": active,
                        })}
                        onClick={() => setSelectedId(friend.id)}
                      >
                        <div className="bp-friends__avatar-wrap">
                          {friend.profileImageUrl ? (
                            <img
                              src={friend.profileImageUrl}
                              alt={friend.displayName}
                            />
                          ) : (
                            <div className="bp-friends__avatar-fallback">
                              {friend.displayName.slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <span
                            className={cn("bp-friends__status-dot", {
                              "bp-friends__status-dot--online": friend.isOnline,
                            })}
                          />
                        </div>

                        <div className="bp-friends__friend-info">
                          <div className="bp-friends__friend-top">
                            <span className="bp-friends__friend-name">
                              {friend.displayName}
                            </span>
                            <span
                              className={cn(
                                "bp-friends__provider-tag",
                                `bp-friends__provider-tag--${provider}`
                              )}
                            >
                              {provider === "steam" ? (
                                <SteamLogo width={11} height={11} />
                              ) : (
                                <EpicLogo width={11} height={11} />
                              )}
                            </span>
                          </div>
                          <span className="bp-friends__friend-sub">
                            {friend.currentGame?.title ||
                              friend.richPresence ||
                              (friend.isOnline ? "Online" : "Offline")}
                          </span>
                        </div>

                        {unreadCount > 0 && (
                          <span className="bp-friends__unread">
                            {unreadCount}
                          </span>
                        )}
                      </button>
                    </FocusItem>
                  );
                })
              )}
            </ScrollArea>
          </VerticalFocusGroup>

          <VerticalFocusGroup
            regionId={FRIENDS_CHAT_REGION_ID}
            className="bp-friends__chat-panel"
          >
            {!selectedFriend ? (
              <div className="bp-friends__placeholder">
                Selecione um amigo para conversar ou chamar para jogar.
              </div>
            ) : (
              <>
                <div className="bp-friends__chat-header">
                  <div className="bp-friends__chat-peer">
                    <div>
                      <h2>{selectedFriend.displayName}</h2>
                      <span>
                        {selectedFriend.currentGame?.title ||
                          selectedFriend.richPresence ||
                          (selectedFriend.isOnline ? "Online" : "Offline")}
                      </span>
                    </div>
                  </div>

                  <div className="bp-friends__chat-actions">
                    {selectedFriend.gameLobby?.joinable && (
                      <Button
                        focusId={FRIENDS_JOIN_BUTTON_ID}
                        size="small"
                        variant="primary"
                        icon={<PlayIcon size={14} weight="fill" />}
                        onClick={() => void handleJoinSelectedLobby()}
                      >
                        Entrar
                      </Button>
                    )}

                    <Button
                      focusId={FRIENDS_INVITE_BUTTON_ID}
                      size="small"
                      variant="secondary"
                      icon={<GameControllerIcon size={15} />}
                      onClick={() => void handleToggleInvitePicker()}
                    >
                      Chamar para jogar
                    </Button>
                  </div>
                </div>

                {showInvitePicker && (
                  <div className="bp-friends__invite-bar">
                    <span className="bp-friends__invite-bar-title">
                      Escolha um jogo para convidar {selectedFriend.displayName}
                      :
                    </span>
                    <div className="bp-friends__invite-games">
                      {loadingGames ? (
                        <span>Carregando jogos...</span>
                      ) : invitableGames.length === 0 ? (
                        <span>
                          Nenhum jogo encontrado. Sincronize sua conta nas
                          configurações.
                        </span>
                      ) : (
                        invitableGames.slice(0, 10).map((game) => (
                          <Button
                            key={`${game.shop}:${game.objectId}`}
                            size="small"
                            variant="tertiary"
                            onClick={() => void handleInviteGame(game)}
                          >
                            {game.title}
                          </Button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                <ScrollArea
                  showScrollbar
                  className="bp-friends__messages-scroll"
                >
                  {messages.length === 0 ? (
                    <div className="bp-friends__placeholder">
                      Nenhuma mensagem ainda. Envie um oi ou um convite!
                    </div>
                  ) : (
                    messages.map((msg) => {
                      const fromMe = msg.senderId !== selectedFriend.id;
                      return (
                        <div
                          key={msg.clientNonce || msg.seq}
                          className={cn("bp-friends__message", {
                            "bp-friends__message--mine": fromMe,
                          })}
                        >
                          {msg.body && <span>{msg.body}</span>}
                          {msg.invite && (
                            <div className="bp-friends__invite-box">
                              <div className="bp-friends__invite-meta">
                                <small>
                                  {fromMe
                                    ? "Convite enviado"
                                    : "Convite para jogar"}
                                </small>
                                <strong>{msg.invite.gameTitle}</strong>
                              </div>
                              <Button
                                size="small"
                                variant="primary"
                                onClick={() =>
                                  void handleAcceptInvite(msg.invite!)
                                }
                              >
                                Entrar
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                  <div ref={messagesEndRef} />
                </ScrollArea>

                <HorizontalFocusGroup className="bp-friends__composer">
                  <Input
                    focusId={FRIENDS_CHAT_INPUT_ID}
                    className="bp-friends__composer-input"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={`Mensagem para ${selectedFriend.displayName}...`}
                  />
                  <Button
                    focusId={FRIENDS_CHAT_SEND_ID}
                    disabled={sending || !draft.trim()}
                    icon={<PaperPlaneTiltIcon size={15} />}
                    onClick={() => void handleSend()}
                  >
                    Enviar
                  </Button>
                </HorizontalFocusGroup>
              </>
            )}
          </VerticalFocusGroup>
        </div>
      )}
    </VerticalFocusGroup>
  );
}
