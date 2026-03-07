import { useStoryStore } from '../store';
import { useAction } from '../hooks/use-action';
import { useInterpolate } from '../hooks/use-interpolate';

interface PassageLinkProps {
  target: string;
  className?: string;
  id?: string;
  children: preact.ComponentChildren;
}

export function PassageLink({
  target,
  className,
  id,
  children,
}: PassageLinkProps) {
  const navigate = useStoryStore((s) => s.navigate);
  const resolve = useInterpolate();
  className = resolve(className);
  id = resolve(id);

  const handleClick = (e: MouseEvent) => {
    e.preventDefault();
    navigate(target);
  };

  useAction({
    type: 'link',
    key: target,
    authorId: id,
    label: typeof children === 'string' ? children : target,
    target,
    perform: () => navigate(target),
  });

  const cls = className ? `passage-link ${className}` : 'passage-link';

  return (
    <a
      href="#"
      id={id}
      class={cls}
      onClick={handleClick}
    >
      {children}
    </a>
  );
}
