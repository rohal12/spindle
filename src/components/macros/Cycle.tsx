import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'cycle',
  storeVar: true,
  render({ children = [] }, ctx) {
    const options = ctx.extractOptions(children);

    const handleClick = () => {
      if (options.length === 0) return;
      const currentIndex = options.indexOf(String(ctx.value));
      const nextIndex = (currentIndex + 1) % options.length;
      ctx.setValue!(options[nextIndex]);
    };

    ctx.useAction({
      type: 'cycle',
      key: `$${ctx.varName}`,
      authorId: ctx.id,
      label: ctx.value == null ? options[0] || '' : String(ctx.value),
      variable: ctx.varName,
      options,
      value: ctx.value,
      perform: (v) => {
        if (v !== undefined) {
          ctx.setValue!(v);
        } else {
          handleClick();
        }
      },
    });

    return (
      <button
        id={ctx.id}
        class={ctx.cls}
        onClick={handleClick}
      >
        {ctx.value == null ? options[0] || '' : String(ctx.value)}
      </button>
    );
  },
});
