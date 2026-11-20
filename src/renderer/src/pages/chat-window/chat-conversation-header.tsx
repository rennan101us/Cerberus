import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DashIcon, LinkExternalIcon, XIcon } from "@primer/octicons-react";
import { Gamepad2, Play } from "lucide-react";
import cn from "classnames";

import { buildGameDetailsPath } from "@renderer/helpers";
import { buildCerberusInviteUrl } from "@shared";
import SteamLogo from "@renderer/assets/steam-logo.svg?react";
import EpicLogo from "@renderer/assets/epic-integration-logo.svg?react";
import type {
  SocialGameInvite,
  SocialInvitableGame,
  StoreProvider,
  UserFriend,
} from "@types";

import { ChatFriendAvatar, ChatFriendStatus } from "./chat-friend-status";
import { ChatOfficialBadge } from "./chat-official-badge";
import { isOfficialAccount } from "./chat-sidebar-layout";

const electron = globalThis.electron as Electron;

const getFriendProvider = (friend: UserFriend): StoreProvider =>
  friend.provider ?? (friend.id.startsWith("epic:") ? "epic" : "steam");

export interface ChatConversationHeaderProps {
  /** Null before the first conversation opens: only the window controls show. */
  friend: UserFriend | null;
  isTyping: boolean;
  onMinimize: () => void;
  onCloseWindow: () => void;
}

/**
 * The active conversation's friend, at the top of the chat pane, doubling as
 * the (frameless) window's title bar with its controls. It keeps one height
 * with or without a banner, so switching conversations never moves the
 * messages.
 */
export function ChatConversationHeader({
  friend,
  isTyping,
  onMinimize,
  onCloseWindow,
}: Readonly<ChatConversationHeaderProps>) {
  const { t } = useTranslation("chat_window");

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [invitableGames, setInvitableGames] = useState<SocialInvitableGame[]>(
    []
  );
  const [loadingGames, setLoadingGames] = useState(false);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setIsInviteOpen(false);
    setFeedback(null);
  }, [friend?.id]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 3500);
    return () => clearTimeout(timer);
  }, [feedback]);

  const backgroundImageUrl = friend?.backgroundImageUrl;
  const currentGame = friend?.currentGame;
  const isStoreFriend = Boolean(
    friend && (friend.id.startsWith("steam:") || friend.id.startsWith("epic:"))
  );
  const provider = friend ? getFriendProvider(friend) : "steam";

  const handleToggleInvite = async () => {
    if (!friend) return;
    if (isInviteOpen) {
      setIsInviteOpen(false);
      return;
    }

    setIsInviteOpen(true);
    setLoadingGames(true);
    try {
      const games = await electron.socialGetInvitableGames(provider);
      setInvitableGames(games);
    } catch {
      setInvitableGames([]);
    } finally {
      setLoadingGames(false);
    }
  };

  const handleSendInvite = async (game: SocialInvitableGame) => {
    if (!friend) return;
    const key = `${game.shop}:${game.objectId}`;
    setSendingKey(key);
    try {
      await electron.socialSendGameInvite({
        friendId: friend.id,
        gameShop: game.shop,
        objectId: game.objectId,
        gameTitle: game.title,
      });
      setIsInviteOpen(false);
      setFeedback(`Convite enviado: ${game.title}`);
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Falha ao enviar convite."
      );
    } finally {
      setSendingKey(null);
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
        setFeedback("Link Cerberus copiado!");
        setIsInviteOpen(false);
      })
      .catch(() => {});
  };

  const handleJoinFriend = async () => {
    if (!friend) return;
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
        setFeedback(`Abrindo ${invite.gameTitle}...`);
      } else {
        setFeedback(
          `${invite.gameTitle} não está instalado neste dispositivo.`
        );
      }
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Erro ao entrar no jogo."
      );
    }
  };

  return (
    <header
      className={cn("chat-window__conversation-header", {
        "chat-window__conversation-header--banner": backgroundImageUrl,
      })}
    >
      {backgroundImageUrl && (
        <div className="chat-window__header-banner" aria-hidden="true">
          <img src={backgroundImageUrl} alt="" />
        </div>
      )}

      {friend && isOfficialAccount(friend) && (
        <>
          <ChatFriendAvatar friend={friend} size={32} />

          <div className="chat-window__conversation-details">
            <span className="chat-window__conversation-title">
              <span className="chat-window__conversation-name">
                {friend.displayName}
              </span>
              <ChatOfficialBadge size={16} />
            </span>
            <span className="chat-window__friend-status">
              {t("official_subtitle")}
            </span>
          </div>
        </>
      )}

      {friend && !isOfficialAccount(friend) && (
        <>
          <ChatFriendAvatar friend={friend} size={32} />

          <div className="chat-window__conversation-details">
            <span className="chat-window__conversation-title">
              <span className="chat-window__conversation-name">
                {friend.displayName}
              </span>
              {isStoreFriend && (
                <span
                  className={cn(
                    "chat-window__provider-badge",
                    `chat-window__provider-badge--${provider}`
                  )}
                  title={provider === "steam" ? "Steam" : "Epic Games"}
                >
                  {provider === "steam" ? (
                    <SteamLogo width={11} height={11} />
                  ) : (
                    <EpicLogo width={11} height={11} />
                  )}
                </span>
              )}
            </span>

            {feedback ? (
              <span className="chat-window__header-feedback">{feedback}</span>
            ) : currentGame && !isTyping ? (
              <button
                type="button"
                className="chat-window__game-link"
                onClick={() =>
                  electron.openGameInMainWindow(
                    buildGameDetailsPath(currentGame)
                  )
                }
                title={t("open_game", { game: currentGame.title })}
              >
                <ChatFriendStatus friend={friend} />
                <LinkExternalIcon
                  size={12}
                  className="chat-window__game-link-icon"
                />
              </button>
            ) : (
              <ChatFriendStatus friend={friend} isTyping={isTyping} />
            )}
          </div>

          {isStoreFriend && (
            <div className="chat-window__header-actions">
              {friend.gameLobby?.joinable && (
                <button
                  type="button"
                  className="chat-window__header-join-button"
                  onClick={() => void handleJoinFriend()}
                  title={`Entrar no jogo de ${friend.displayName}`}
                >
                  <Play size={12} />
                  <span>Entrar</span>
                </button>
              )}

              <div className="chat-window__header-invite-wrap">
                <button
                  type="button"
                  className={cn("chat-window__header-invite-button", {
                    "chat-window__header-invite-button--active": isInviteOpen,
                  })}
                  onClick={() => void handleToggleInvite()}
                  title="Chamar para jogar"
                  aria-expanded={isInviteOpen}
                >
                  <Gamepad2 size={14} />
                  <span>Chamar para jogar</span>
                </button>

                {isInviteOpen && (
                  <div className="chat-window__header-invite-popover">
                    <div className="chat-window__header-invite-popover-title">
                      <span>
                        Escolha um jogo (
                        {provider === "steam" ? "Steam" : "Epic"})
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsInviteOpen(false)}
                        aria-label="Fechar"
                      >
                        <XIcon size={12} />
                      </button>
                    </div>
                    {loadingGames ? (
                      <p className="chat-window__header-invite-empty">
                        Carregando jogos...
                      </p>
                    ) : invitableGames.length === 0 ? (
                      <p className="chat-window__header-invite-empty">
                        Nenhum jogo encontrado. Sincronize sua conta em
                        Configurações → Integrações.
                      </p>
                    ) : (
                      <div className="chat-window__header-invite-list">
                        {invitableGames.slice(0, 15).map((game) => {
                          const key = `${game.shop}:${game.objectId}`;
                          const busy = sendingKey === key;
                          return (
                            <button
                              key={key}
                              type="button"
                              disabled={busy}
                              className="chat-window__header-invite-item"
                              onClick={() => void handleSendInvite(game)}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                handleCopyCerberusInvite(game);
                              }}
                              title="Clique com botão esquerdo para enviar no chat. Botão direito para copiar link Cerberus."
                            >
                              <span>{game.title}</span>
                              <small>
                                {busy
                                  ? "Enviando..."
                                  : game.isInstalled
                                    ? "Instalado"
                                    : "Biblioteca"}
                              </small>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {!electron.hasNativeWindowDecorations && (
        <div className="chat-window__window-controls">
          <button
            type="button"
            className="chat-window__window-control"
            onClick={onMinimize}
            title={t("minimize")}
            aria-label={t("minimize")}
          >
            <DashIcon size={16} />
          </button>
          <button
            type="button"
            className="chat-window__window-control chat-window__window-control--close"
            onClick={onCloseWindow}
            title={t("close_window")}
            aria-label={t("close_window")}
          >
            <XIcon size={16} />
          </button>
        </div>
      )}
    </header>
  );
}
