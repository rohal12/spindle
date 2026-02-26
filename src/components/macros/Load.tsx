import { useStoryStore } from "../../store";

interface LoadProps {
  className?: string;
  id?: string;
}

export function Load({ className, id }: LoadProps) {
  const load = useStoryStore((s) => s.load);
  const hasSave = useStoryStore((s) => s.hasSave);
  // Subscribe to saveVersion so we re-render when a save is created
  useStoryStore((s) => s.saveVersion);
  const cls = className ? `menubar-button ${className}` : "menubar-button";
  const disabled = !hasSave();

  const handleClick = () => {
    if (confirm("Load saved game? Current progress will be lost.")) {
      load();
    }
  };

  return (
    <button id={id} class={cls} disabled={disabled} onClick={handleClick}>
      Load
    </button>
  );
}
