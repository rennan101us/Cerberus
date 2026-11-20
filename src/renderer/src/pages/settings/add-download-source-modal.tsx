import { useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button, Modal, SelectField, TextField } from "@renderer/components";
import { settingsContext } from "@renderer/context";
import { useForm } from "react-hook-form";
import { logger } from "@renderer/logger";

import * as yup from "yup";
import { yupResolver } from "@hookform/resolvers/yup";
import { SyncIcon } from "@primer/octicons-react";
import "./add-download-source-modal.scss";

interface AddDownloadSourceModalProps {
  visible: boolean;
  onClose: () => void;
  onAddDownloadSource: () => void;
}

interface FormValues {
  name: string;
  url: string;
}

export function AddDownloadSourceModal({
  visible,
  onClose,
  onAddDownloadSource,
}: Readonly<AddDownloadSourceModalProps>) {
  const [isLoading, setIsLoading] = useState(false);
  const [sourceKind, setSourceKind] = useState<"auto" | "hydra" | "switch">(
    "auto"
  );

  const { t } = useTranslation("settings");

  const schema: yup.ObjectSchema<FormValues> = yup.object({
    name: yup.string().defined().default(""),
    url: yup
      .string()
      .required(t("required_field"))
      .test(
        "valid-url-or-magnet",
        t("must_be_valid_url"),
        (val) =>
          Boolean(val) &&
          (val!.trim().startsWith("magnet:") ||
            /^https?:\/\/.+/i.test(val!.trim()))
      ),
  });

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    clearErrors,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    defaultValues: { name: "", url: "" },
    resolver: yupResolver(schema),
  });

  const { sourceUrl } = useContext(settingsContext);

  const onSubmit = async (values: FormValues) => {
    setIsLoading(true);

    try {
      await window.electron.addDownloadSource(values.url.trim(), {
        name: values.name?.trim() || undefined,
        kind: sourceKind,
      });

      onClose();
      onAddDownloadSource();
    } catch (error) {
      logger.error("Failed to add download source:", error);
      const errorMessage =
        error instanceof Error && error.message.includes("already exists")
          ? t("download_source_already_exists")
          : t("failed_add_download_source");

      setError("url", {
        type: "server",
        message: errorMessage,
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setValue("name", "");
    setValue("url", "");
    setSourceKind("auto");
    clearErrors();
    setIsLoading(false);

    if (sourceUrl) {
      setValue("url", sourceUrl);
    }
  }, [visible, clearErrors, setValue, sourceUrl]);

  const handleClose = () => {
    if (isLoading) return;
    onClose();
  };

  return (
    <Modal
      visible={visible}
      title={t("add_download_source")}
      description="Adicione fontes JSON de jogos Windows ou URLs de sites/diretórios/magnet de Switch 1 e Switch 2 (ex: blueroms, romshq, nswpedia)."
      onClose={handleClose}
      clickOutsideToClose={!isLoading}
    >
      <div className="add-download-source-modal__container">
        <form onSubmit={handleSubmit(onSubmit)}>
          <SelectField
            label="Tipo de Fonte"
            theme="dark"
            value={sourceKind}
            onChange={(e) =>
              setSourceKind(e.target.value as "auto" | "hydra" | "switch")
            }
            options={[
              {
                key: "auto",
                value: "auto",
                label: "Detectar automaticamente (JSON PC ou Switch 1/2)",
              },
              {
                key: "switch",
                value: "switch",
                label:
                  "Switch 1 & 2 (Site, Diretório, MediaFire, GDrive, Magnet)",
              },
              {
                key: "hydra",
                value: "hydra",
                label: "Jogos Windows (JSON Hydra)",
              },
            ]}
          />

          <TextField
            {...register("name")}
            label="Nome (opcional)"
            placeholder="Ex: blueroms, romshq, nswpedia"
          />

          <TextField
            {...register("url")}
            label={t("download_source_url")}
            placeholder="https://www.blueroms.ws/switch2, https://.../source.json ou magnet:..."
            error={errors.url?.message}
          />

          <div className="add-download-source-modal__actions">
            <Button
              type="button"
              theme="outline"
              onClick={handleClose}
              disabled={isLoading}
            >
              {t("cancel")}
            </Button>

            <Button type="submit" disabled={isSubmitting || isLoading}>
              {isLoading && (
                <SyncIcon className="add-download-source-modal__spinner" />
              )}
              {isLoading ? t("adding") : t("add_download_source")}
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
