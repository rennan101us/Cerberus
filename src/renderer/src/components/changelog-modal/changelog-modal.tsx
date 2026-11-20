import {
  CheckCircleFillIcon,
  RocketIcon,
  TagIcon,
  ToolsIcon,
} from "@primer/octicons-react";
import { Modal } from "../modal/modal";
import changelogEntries from "@renderer/data/cerberus-changelog.json";
import "./changelog-modal.scss";

interface ChangelogChange {
  type: "feature" | "improvement" | "fix";
  text: string;
}

interface ChangelogEntry {
  version: string;
  releaseDate: string;
  title: string;
  summary: string;
  changes: ChangelogChange[];
}

export interface ChangelogModalProps {
  visible: boolean;
  onClose: () => void;
}

const getChangeMeta = (type: ChangelogChange["type"]) => {
  switch (type) {
    case "feature":
      return {
        label: "Novidade",
        icon: <RocketIcon size={14} />,
        className: "changelog-modal__badge--feature",
      };
    case "fix":
      return {
        label: "Correção",
        icon: <ToolsIcon size={14} />,
        className: "changelog-modal__badge--fix",
      };
    default:
      return {
        label: "Melhoria",
        icon: <CheckCircleFillIcon size={14} />,
        className: "changelog-modal__badge--improvement",
      };
  }
};

export function ChangelogModal({
  visible,
  onClose,
}: Readonly<ChangelogModalProps>) {
  const entries = changelogEntries as ChangelogEntry[];

  return (
    <Modal
      visible={visible}
      title="Notas de Versão — Cerberus"
      description="Histórico oficial de atualizações e novidades da plataforma Cerberus."
      onClose={onClose}
      large
    >
      <div className="changelog-modal">
        {entries.map((entry) => (
          <article key={entry.version} className="changelog-modal__release">
            <header className="changelog-modal__release-header">
              <div className="changelog-modal__release-title-group">
                <span className="changelog-modal__version-pill">
                  <TagIcon size={12} />v{entry.version}
                </span>
                <h3 className="changelog-modal__release-title">
                  {entry.title}
                </h3>
              </div>
              <time className="changelog-modal__release-date">
                {entry.releaseDate}
              </time>
            </header>

            {entry.summary && (
              <p className="changelog-modal__summary">{entry.summary}</p>
            )}

            <ul className="changelog-modal__list">
              {entry.changes.map((change, index) => {
                const meta = getChangeMeta(change.type);
                return (
                  <li
                    key={`${entry.version}-${index}`}
                    className="changelog-modal__item"
                  >
                    <span
                      className={`changelog-modal__badge ${meta.className}`}
                    >
                      {meta.icon}
                      {meta.label}
                    </span>
                    <span className="changelog-modal__item-text">
                      {change.text}
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>
        ))}
      </div>
    </Modal>
  );
}
