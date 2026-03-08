import { collectText } from '../../utils/extract-text';
import { currentSourceLocation } from '../../utils/source-location';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'button',
  interpolate: true,
  render({ rawArgs, children = [] }, ctx) {
    const handleClick = () => {
      try {
        ctx.mutate(rawArgs);
      } catch (err) {
        console.error(
          `spindle: Error in {button ${rawArgs}}${currentSourceLocation()}:`,
          err,
        );
      }
    };

    ctx.useAction({
      type: 'button',
      key: rawArgs,
      authorId: ctx.id,
      label: collectText(children) || rawArgs,
      perform: handleClick,
    });

    return (
      <button
        id={ctx.id}
        class={ctx.cls}
        onClick={handleClick}
      >
        {ctx.renderInlineNodes(children)}
      </button>
    );
  },
});
