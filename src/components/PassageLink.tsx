import { useStoryStore } from "../store";

interface PassageLinkProps {
  target: string;
  className?: string;
  id?: string;
  children: preact.ComponentChildren;
}

export function PassageLink({ target, className, id, children }: PassageLinkProps) {
  const navigate = useStoryStore((s) => s.navigate);

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    navigate(target);
  };

  const cls = className ? `passage-link ${className}` : "passage-link";

  return (
    <a href="#" id={id} class={cls} onClick={handleClick}>
      {children}
    </a>
  );
}
