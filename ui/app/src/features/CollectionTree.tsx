import { useState } from "react";
import type { Collection, TreeNode } from "../lib/types";
import { useWorkspace } from "../store/workspace";
import { confirmDialog, promptDialog } from "../store/ui";
import { useT } from "../store/i18n";
import { findNode } from "../store/tree";
import { IconBraces, IconFolderPlus, IconKey } from "./icons";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import { CollectionAuthDialog } from "./CollectionAuthDialog";
import { RunnerDialog } from "./RunnerDialog";
import { ExportDialog } from "./ExportDialog";
import { ScriptsPanel } from "./ScriptsPanel";
import { Button, Modal } from "./Modal";

interface MenuState {
  x: number;
  y: number;
  collectionId: string;
  node: TreeNode;
}

export function CollectionTree({ collection }: { collection: Collection }) {
  const {
    addRequestNode,
    addFolder,
    deleteCollection,
    renameNode,
    duplicateNode,
    deleteNode,
    openRequestNode,
    setFocusTab,
    addBlankExample,
    setCollectionAuth,
    setCollectionScripts,
    setFolderAuth,
  } = useWorkspace();
  const t = useT();
  const [runnerOpen, setRunnerOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  // Target dialog Authorization: collection atau folder tertentu.
  const [authTarget, setAuthTarget] = useState<{ nodeId?: string; name: string } | null>(null);

  async function removeCollection() {
    const ok = await confirmDialog({
      title: t("deleteCollectionTitle"),
      message: t("deleteCollectionMsg", { name: collection.name }),
      confirmLabel: t("delete"),
      danger: true,
    });
    if (ok) deleteCollection(collection.id);
  }

  async function addFolderPrompt() {
    const name = await promptDialog({
      title: t("newFolder"),
      placeholder: t("folderNamePh"),
      defaultValue: "New Folder",
    });
    if (name) addFolder(collection.id, null, name);
  }

  async function renamePrompt(collectionId: string, node: TreeNode) {
    const name = await promptDialog({
      title: t("renameTitle"),
      defaultValue: node.name,
      placeholder: t("newNamePh"),
    });
    if (name) renameNode(collectionId, node.id, name);
  }

  async function removeNodePrompt(collectionId: string, node: TreeNode) {
    const ok = await confirmDialog({
      title: node.type === "folder" ? t("deleteFolderTitle") : t("deleteRequestTitle"),
      message:
        node.type === "folder"
          ? t("deleteFolderMsg", { name: node.name })
          : t("deleteRequestMsg", { name: node.name }),
      confirmLabel: t("delete"),
      danger: true,
    });
    if (ok) deleteNode(collectionId, node.id);
  }

  function menuItems(m: MenuState): MenuItem[] {
    const { collectionId, node } = m;
    const items: MenuItem[] = [];
    if (node.type === "request") {
      items.push({
        label: t("addExample"),
        onClick: () => {
          openRequestNode(collectionId, node.id);
          addBlankExample();
          setFocusTab("examples");
        },
      });
      items.push({ sep: true });
    }
    if (node.type === "folder") {
      items.push({
        label: t("authorizationEllipsis"),
        onClick: () => setAuthTarget({ nodeId: node.id, name: node.name }),
      });
      items.push({ sep: true });
    }
    items.push({ label: t("renameTitle"), shortcut: "F2", onClick: () => renamePrompt(collectionId, node) });
    items.push({
      label: t("duplicate"),
      shortcut: "Ctrl+D",
      onClick: () => duplicateNode(collectionId, node.id),
    });
    items.push({ sep: true });
    items.push({
      label: t("delete"),
      shortcut: "Del",
      danger: true,
      onClick: () => removeNodePrompt(collectionId, node),
    });
    return items;
  }

  const openMenu = (e: React.MouseEvent, collectionId: string, node: TreeNode) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, collectionId, node });
  };

  return (
    <div className="mb-1">
      <div className="group flex items-center gap-1 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        <span className="flex-1 truncate">{collection.name}</span>
        <button
          title={t("runCollection")}
          aria-label={t("runCollection")}
          onClick={() => setRunnerOpen(true)}
          className="opacity-0 hover:text-emerald-400 group-hover:opacity-100"
        >
          ▶
        </button>
        <button
          title={t("authCollection")}
          aria-label={t("authCollection")}
          onClick={() => setAuthTarget({ name: collection.name })}
          className="opacity-0 hover:text-brand-fg group-hover:opacity-100"
        >
          <IconKey />
        </button>
        <button
          title={t("collectionScripts")}
          aria-label={t("collectionScripts")}
          onClick={() => setScriptsOpen(true)}
          className="opacity-0 hover:text-brand-fg group-hover:opacity-100"
        >
          <IconBraces />
        </button>
        <button
          title={t("exportTitle")}
          aria-label={t("exportTitle")}
          onClick={() => setExportOpen(true)}
          className="opacity-0 hover:text-sky-400 group-hover:opacity-100"
        >
          ⇩
        </button>
        <button
          title={t("newRequest")}
          aria-label={t("newRequest")}
          onClick={() => addRequestNode(collection.id, null)}
          className="opacity-0 hover:text-brand-fg group-hover:opacity-100"
        >
          ＋
        </button>
        <button
          title={t("newFolder")}
          aria-label={t("newFolder")}
          onClick={addFolderPrompt}
          className="opacity-0 hover:text-brand-fg group-hover:opacity-100"
        >
          <IconFolderPlus />
        </button>
        <button
          title={t("deleteCollectionTip")}
          aria-label={t("deleteCollectionTip")}
          onClick={removeCollection}
          className="opacity-0 hover:text-rose-400 group-hover:opacity-100"
        >
          ×
        </button>
      </div>
      <RunnerDialog
        collection={collection}
        open={runnerOpen}
        onClose={() => setRunnerOpen(false)}
      />
      <ExportDialog
        collection={exportOpen ? collection : null}
        open={exportOpen}
        onClose={() => setExportOpen(false)}
      />
      <Modal
        open={scriptsOpen}
        title={`${t("collectionScripts")} — ${collection.name}`}
        onClose={() => setScriptsOpen(false)}
        wide
        footer={
          <Button variant="primary" onClick={() => setScriptsOpen(false)}>
            {t("doneWord")}
          </Button>
        }
      >
        <p className="mb-2 text-xs text-neutral-500">{t("collectionScriptsHint")}</p>
        <ScriptsPanel
          scripts={collection.scripts}
          onChange={(scripts) => setCollectionScripts(collection.id, scripts)}
        />
      </Modal>
      <ul>
        {collection.nodes.map((n) => (
          <NodeRow
            key={n.id}
            collectionId={collection.id}
            node={n}
            depth={0}
            onContext={openMenu}
          />
        ))}
        {collection.nodes.length === 0 && (
          <li className="px-3 py-1 text-xs text-neutral-600">{t("emptyCollection")}</li>
        )}
      </ul>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu)} onClose={() => setMenu(null)} />
      )}

      {authTarget &&
        (() => {
          const folderNode = authTarget.nodeId
            ? findNode(collection.nodes, authTarget.nodeId)
            : undefined;
          const auth =
            folderNode && folderNode.type === "folder" ? folderNode.auth : collection.auth;
          return (
            <CollectionAuthDialog
              open
              title={`${authTarget.nodeId ? "Folder" : "Collection"}: ${authTarget.name}`}
              auth={auth}
              onChange={(a) =>
                authTarget.nodeId
                  ? setFolderAuth(collection.id, authTarget.nodeId, a)
                  : setCollectionAuth(collection.id, a)
              }
              onClose={() => setAuthTarget(null)}
            />
          );
        })()}
    </div>
  );
}

function NodeRow({
  collectionId,
  node,
  depth,
  onContext,
}: {
  collectionId: string;
  node: TreeNode;
  depth: number;
  onContext: (e: React.MouseEvent, collectionId: string, node: TreeNode) => void;
}) {
  const [open, setOpen] = useState(true);
  const { openRequestNode, addRequestNode, addFolder, setFocusTab, activeTabId, tabs } =
    useWorkspace();
  const t = useT();

  const activeTab = tabs.find((tb) => tb.id === activeTabId);
  const isActive = node.type === "request" && activeTab?.savedNodeId === node.id;
  const pad = { paddingLeft: `${depth * 12 + 12}px` };

  async function addFolderHere() {
    const name = await promptDialog({
      title: t("newFolder"),
      defaultValue: "New Folder",
      placeholder: t("folderNamePh"),
    });
    if (name) addFolder(collectionId, node.id, name);
  }

  if (node.type === "folder") {
    return (
      <li>
        <div
          className="group flex items-center gap-1 py-1 pr-3 text-sm hover:bg-neutral-800/50"
          style={pad}
          onContextMenu={(e) => onContext(e, collectionId, node)}
        >
          <button onClick={() => setOpen((o) => !o)} className="w-4 text-neutral-500">
            {open ? "▾" : "▸"}
          </button>
          <span className="flex-1 cursor-pointer truncate" onClick={() => setOpen((o) => !o)}>
            {node.name}
          </span>
          <button
            title={t("newRequest")}
            aria-label={t("newRequest")}
            onClick={() => addRequestNode(collectionId, node.id)}
            className="opacity-0 hover:text-brand-fg group-hover:opacity-100"
          >
            ＋
          </button>
          <button
            title={t("newFolder")}
            aria-label={t("newFolder")}
            onClick={addFolderHere}
            className="opacity-0 hover:text-brand-fg group-hover:opacity-100"
          >
            <IconFolderPlus />
          </button>
          <NodeMenu onMore={(e) => onContext(e, collectionId, node)} />
        </div>
        {open && (
          <ul>
            {node.children.map((c) => (
              <NodeRow
                key={c.id}
                collectionId={collectionId}
                node={c}
                depth={depth + 1}
                onContext={onContext}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const examples = node.request.examples ?? [];
  const hasExamples = examples.length > 0;

  return (
    <li>
      <div
        className={`group flex items-center gap-1.5 py-1 pr-3 text-sm hover:bg-neutral-800/50 ${
          isActive ? "bg-neutral-800" : ""
        }`}
        style={pad}
        onContextMenu={(e) => onContext(e, collectionId, node)}
      >
        {hasExamples ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="w-4 shrink-0 text-neutral-500 hover:text-neutral-200"
          >
            {open ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        <span className={`method-${node.request.method} w-10 shrink-0 font-mono text-[10px] font-bold`}>
          {node.request.method}
        </span>
        <span
          className="flex-1 cursor-pointer truncate"
          onClick={() => openRequestNode(collectionId, node.id)}
        >
          {node.name}
        </span>
        {hasExamples && (
          <span className="shrink-0 text-[10px] text-neutral-600">{examples.length}</span>
        )}
        <NodeMenu onMore={(e) => onContext(e, collectionId, node)} />
      </div>

      {/* Contoh response ter-nest di bawah request (dropdown, mirip Postman). */}
      {open &&
        examples.map((ex) => {
          const ok = ex.status >= 200 && ex.status < 300;
          return (
            <div
              key={ex.id}
              onClick={() => {
                openRequestNode(collectionId, node.id);
                setFocusTab("examples");
              }}
              style={{ paddingLeft: `${depth * 12 + 8 + 22}px` }}
              className="flex cursor-pointer items-center gap-2 py-0.5 pr-2 text-xs text-neutral-400 hover:bg-neutral-800/40"
              title={t("viewExample")}
            >
              <span className="shrink-0 text-neutral-600">↳</span>
              <span className={`shrink-0 font-mono text-[10px] ${ok ? "text-emerald-500" : "text-rose-500"}`}>
                {ex.status || "—"}
              </span>
              <span className="truncate">{ex.name}</span>
            </div>
          );
        })}
    </li>
  );
}

function NodeMenu({ onMore }: { onMore: (e: React.MouseEvent) => void }) {
  const t = useT();
  return (
    <button
      title={t("menu")}
      aria-label={t("menu")}
      onClick={onMore}
      className="px-1 text-neutral-500 opacity-0 hover:text-neutral-200 group-hover:opacity-100"
    >
      ⋯
    </button>
  );
}
