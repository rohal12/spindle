import { RepeatContext } from './Repeat';
import { defineMacro } from '../../define-macro';

defineMacro({
  name: 'stop',
  render(_props, ctx) {
    const { stop } = ctx.hooks.useContext(RepeatContext);

    ctx.hooks.useLayoutEffect(() => {
      stop();
    }, [stop]);

    return null;
  },
});
