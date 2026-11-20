import { useEffect, useState } from "react";
import {
  ThumbsupIcon,
  ThumbsdownIcon,
  CommentDiscussionIcon,
} from "@primer/octicons-react";
import "./steam-reviews-section.scss";

interface SteamReviewItem {
  id: string;
  authorSteamId: string;
  reviewText: string;
  votedUp: boolean;
  votesUp: number;
  playtimeHours: number;
  createdAt: number;
}

interface SteamReviewsData {
  appId: string;
  reviewScoreDesc: string;
  totalPositive: number;
  totalNegative: number;
  totalReviews: number;
  positivePercent: number;
  reviews: SteamReviewItem[];
}

export interface SteamReviewsSectionProps {
  appId?: string | null;
}

export function SteamReviewsSection({
  appId,
}: Readonly<SteamReviewsSectionProps>) {
  const [data, setData] = useState<SteamReviewsData | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!appId || !/^\d+$/.test(appId.trim())) {
      setData(null);
      return;
    }

    setLoading(true);
    window.electron
      .getSteamAppReviews(appId.trim())
      .then((res: SteamReviewsData | null) => {
        setData(res);
      })
      .catch(() => {
        setData(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [appId]);

  if (!appId || (!loading && !data)) return null;

  const scoreTone =
    data && data.positivePercent >= 70
      ? "positive"
      : data && data.positivePercent >= 40
        ? "mixed"
        : "negative";

  return (
    <section className="steam-reviews-section" aria-label="Análises da Steam">
      <div className="steam-reviews-section__header">
        <div className="steam-reviews-section__title-group">
          <CommentDiscussionIcon size={18} />
          <h3 className="steam-reviews-section__title">
            Análises da Comunidade Steam
          </h3>
          {data && (
            <span
              className={`steam-reviews-section__score-badge steam-reviews-section__score-badge--${scoreTone}`}
            >
              {data.reviewScoreDesc} ({data.positivePercent}%)
            </span>
          )}
        </div>

        {data && (
          <span className="steam-reviews-section__stats">
            {data.totalReviews.toLocaleString()} análises no total (
            {data.totalPositive.toLocaleString()} positivas,{" "}
            {data.totalNegative.toLocaleString()} negativas)
          </span>
        )}
      </div>

      {loading && (
        <div className="steam-reviews-section__loading">
          Carregando análises de usuários...
        </div>
      )}

      {!loading && data && data.reviews.length === 0 && (
        <div className="steam-reviews-section__empty">
          Nenhuma análise em português encontrada no momento.
        </div>
      )}

      {!loading && data && data.reviews.length > 0 && (
        <div className="steam-reviews-section__list">
          {data.reviews.map((review) => (
            <article key={review.id} className="steam-reviews-section__card">
              <div className="steam-reviews-section__card-header">
                <span
                  className={`steam-reviews-section__thumb-badge ${
                    review.votedUp
                      ? "steam-reviews-section__thumb-badge--up"
                      : "steam-reviews-section__thumb-badge--down"
                  }`}
                >
                  {review.votedUp ? (
                    <ThumbsupIcon size={14} />
                  ) : (
                    <ThumbsdownIcon size={14} />
                  )}
                  {review.votedUp ? "Recomendado" : "Não recomendado"}
                </span>

                <span className="steam-reviews-section__playtime">
                  {review.playtimeHours}h registradas
                </span>
              </div>

              <div className="steam-reviews-section__body">
                {review.reviewText}
              </div>

              <div className="steam-reviews-section__footer">
                <span>
                  {new Date(review.createdAt).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    year: "numeric",
                  })}
                </span>

                {review.votesUp > 0 && (
                  <span className="steam-reviews-section__helpful">
                    <ThumbsupIcon size={12} /> {review.votesUp} acharam útil
                  </span>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
