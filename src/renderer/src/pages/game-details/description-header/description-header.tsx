import { useTranslation } from "react-i18next";
import { useContext } from "react";
import { format } from "date-fns";
import { getDateLocale } from "@shared";
import { gameDetailsContext } from "@renderer/context";
import "./description-header.scss";

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function DescriptionHeader() {
  const { shopDetails, game, shop, objectId } = useContext(gameDetailsContext);
  const { t, i18n } = useTranslation("game_details");

  if (!shopDetails) return null;

  const rawDate = shopDetails?.release_date?.date ?? "";
  let displayDate = rawDate;
  if (ISO_DATE_REGEX.test(rawDate)) {
    const parsed = new Date(`${rawDate}T00:00:00`);
    if (!isNaN(parsed.getTime())) {
      displayDate = format(parsed, "MMM d, yyyy", {
        locale: getDateLocale(i18n.language),
      });
    }
  }

  const effectiveShop = game?.shop ?? shop;

  if (effectiveShop === "switch1" || effectiveShop === "switch2") {
    const isSwitch2 =
      effectiveShop === "switch2" ||
      game?.switchGeneration === "switch2" ||
      Boolean(
        (game?.switchTitleId ?? objectId)?.toUpperCase().startsWith("0400")
      );
    const hasMacPort = Boolean(
      game?.switchPortedAppPath || game?.executablePath
    );
    const hasIosPort = Boolean(game?.switchPortedIpaPath);
    const portStatus =
      hasMacPort && hasIosPort
        ? "Portado (macOS + iOS / iPadOS)"
        : hasMacPort
          ? "Portado (macOS)"
          : game?.switchRomPath
            ? "ROM pronta para portar"
            : game
              ? "Aguardando ROM"
              : "Disponível para portar (NxNative / Nx2Android)";

    return (
      <div className="description-header">
        <section className="description-header__info">
          {displayDate && (
            <p>
              {t("release_date", {
                date: displayDate,
              })}
            </p>
          )}
          {Array.isArray(shopDetails.publishers) &&
            shopDetails.publishers.length > 0 && (
              <p>{t("publisher", { publisher: shopDetails.publishers[0] })}</p>
            )}
          <p>
            Console:{" "}
            <strong>
              {isSwitch2 ? "Nintendo Switch 2" : "Nintendo Switch"}
            </strong>
          </p>
          <p>
            Status: <strong>{portStatus}</strong>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="description-header">
      <section className="description-header__info">
        <p>
          {t("release_date", {
            date: displayDate,
          })}
        </p>

        {Array.isArray(shopDetails.publishers) && (
          <p>{t("publisher", { publisher: shopDetails.publishers[0] })}</p>
        )}
      </section>
    </div>
  );
}
