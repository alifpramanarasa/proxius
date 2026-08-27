import type { Auth } from "../lib/types";
import { useWorkspace } from "../store/workspace";
import { envMap } from "../lib/vars";
import { AuthPanel } from "./AuthPanel";
import { Modal } from "./Modal";

/** Editor Authorization untuk collection atau folder. Request di dalamnya yang
 * auth-nya "Inherit" akan memakai auth ini. */
export function CollectionAuthDialog({
  title,
  auth,
  onChange,
  open,
  onClose,
}: {
  title: string;
  auth?: Auth;
  onChange: (a: Auth) => void;
  open: boolean;
  onClose: () => void;
}) {
  const { environments, activeEnvId } = useWorkspace();
  const vars = envMap(environments.find((e) => e.id === activeEnvId));

  return (
    <Modal open={open} title={`Authorization — ${title}`} onClose={onClose} wide>
      <AuthPanel auth={auth ?? { type: "inherit" }} onChange={onChange} vars={vars} />
      <p className="mt-3 border-t border-neutral-800 pt-2 text-[11px] text-neutral-600">
        Semua request di dalam sini yang Auth Type-nya <b>Inherit auth from parent</b> akan
        memakai otorisasi ini.
      </p>
    </Modal>
  );
}
