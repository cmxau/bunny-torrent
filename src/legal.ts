/** Plain-language Terms and Privacy text shown in About. Keep these in step with what the app really does. */
export interface LegalSection {
  h: string;
  p: string[];
}

export const REPO_URL = "https://github.com/cmxau/bunny-torrent";
export const AUTHOR_URL = "https://github.com/cmxau";

export const TERMS: LegalSection[] = [
  {
    h: "Using Bunny Torrent",
    p: [
      "Bunny Torrent is a free, open-source BitTorrent client made by cmxau. By using it you agree to these terms.",
      "It is a tool for transferring files with the BitTorrent protocol. It does not host or verify any content itself.",
    ],
  },
  {
    h: "Your responsibility",
    p: [
      "You alone are responsible for what you download, share and open. Only download and share content you have the right to, and follow the copyright laws that apply to you.",
      "Search results come from third-party sources. They are listed as they are published and are not endorsed, checked or scanned by Bunny Torrent. Treat files from unknown sources with care.",
    ],
  },
  {
    h: "No warranty",
    p: [
      "The app is provided “as is”, without warranties of any kind. It may contain bugs, and downloads can fail or be incomplete. To the fullest extent the law allows, the author is not liable for any loss or damage that results from using it.",
    ],
  },
  {
    h: "Updates",
    p: [
      "If automatic updates are on, the app checks the project's GitHub releases for a newer version and installs it. Updates are cryptographically signed, and the app only installs ones signed with the project's key. You can turn this off in About.",
    ],
  },
  {
    h: "Third-party software",
    p: [
      "Bunny Torrent is built on open-source components, including Tauri and the librqbit BitTorrent engine, each under its own license. See the project repository for details and for the project's own license.",
    ],
  },
  {
    h: "Changes and contact",
    p: [
      "These terms may change as the app does. The latest version is shown here and in the repository. Questions and bug reports go to the project's GitHub page.",
    ],
  },
];

export const PRIVACY: LegalSection[] = [
  {
    h: "The short version",
    p: [
      "Bunny Torrent has no accounts, no analytics and no tracking, and it sends nothing to its developer. Your settings and library stay on your computer.",
    ],
  },
  {
    h: "What is stored on your computer",
    p: [
      "Your settings, library (the torrents you added, plus any categories, tags and saved trackers) and your recent search history are saved in your Windows user folder under BunnyTorrent. The embedded browser keeps a small cache in a folder named dev.bunny.torrent. Downloaded files go to the folders you choose.",
      "You can clear your search history in Settings → Search at any time. Uninstalling the app and deleting those folders removes everything.",
    ],
  },
  {
    h: "What goes over the network",
    p: [
      "BitTorrent peers. This is how BitTorrent works: the peers and trackers of a torrent can see your IP address and which torrent you are sharing. If that matters to you, use a VPN or another privacy tool.",
      "Online search. When you search from Overview, your search words are sent to the sources you have turned on in Settings → Search (for example the Internet Archive or a public torrent index). Those services see your IP address and your query under their own privacy policies.",
      "Updates. If automatic updates are on, the app asks GitHub for the project's latest release at start-up. GitHub sees your IP address and the request.",
      "Your router. If UPnP is on, the app asks your router to open the listening port for incoming connections.",
    ],
  },
  {
    h: "System changes",
    p: [
      "If “Open magnet links with Bunny Torrent” is on, the app registers itself as the handler for magnet links in your Windows user settings. You can turn this off in Settings → General.",
    ],
  },
  {
    h: "Questions",
    p: ["For privacy questions or to report a problem, please open an issue on the project's GitHub page."],
  },
];
