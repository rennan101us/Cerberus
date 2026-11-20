import {
  AppsIcon,
  GearIcon,
  HomeIcon,
  BookIcon,
  TerminalIcon,
} from "@primer/octicons-react";
import { Gamepad2 } from "lucide-react";

import { SidebarDownloadIcon } from "./sidebar-download-icon";

export const routes = [
  {
    path: "/",
    nameKey: "home",
    render: () => <HomeIcon />,
  },
  {
    path: "/catalogue",
    nameKey: "catalogue",
    render: () => <AppsIcon />,
  },
  {
    path: "/library",
    nameKey: "library",
    render: () => <BookIcon />,
  },
  {
    path: "/controllers",
    nameKey: "controllers",
    render: () => <Gamepad2 size={16} strokeWidth={2} />,
  },
  {
    path: "/downloads",
    nameKey: "downloads",
    render: () => <SidebarDownloadIcon />,
  },
  {
    path: "/settings",
    nameKey: "settings",
    render: () => <GearIcon />,
  },
  {
    path: "/logs",
    nameKey: "logs",
    render: () => <TerminalIcon />,
  },
];
