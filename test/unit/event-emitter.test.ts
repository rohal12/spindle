import { describe, it, expect, vi, beforeEach } from 'vitest';
import { on, emit, resetEmitter } from '../../src/event-emitter';

describe('event-emitter', () => {
  beforeEach(() => {
    resetEmitter();
  });

  it('on() returns an unsub that removes the listener', () => {
    const cb = vi.fn();
    const unsub = on('storyinit', cb);
    emit('storyinit');
    expect(cb).toHaveBeenCalledTimes(1);
    unsub();
    emit('storyinit');
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('emit() calls listeners in registration order', () => {
    const order: number[] = [];
    on('beforerestart', () => order.push(1));
    on('beforerestart', () => order.push(2));
    on('beforerestart', () => order.push(3));
    emit('beforerestart');
    expect(order).toEqual([1, 2, 3]);
  });

  it('emit() passes arguments to listeners', () => {
    const cb = vi.fn();
    on('beforesave', cb);
    emit('beforesave', 'slot-1', { meta: true });
    expect(cb).toHaveBeenCalledWith('slot-1', { meta: true });
  });

  it('emit() passes undefined args correctly', () => {
    const cb = vi.fn();
    on('beforesave', cb);
    emit('beforesave', undefined, undefined);
    expect(cb).toHaveBeenCalledWith(undefined, undefined);
  });

  it('unsubscribing during emit does not skip listeners', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    let unsub1: () => void;
    unsub1 = on('storyinit', () => {
      cb1();
      unsub1();
    });
    on('storyinit', cb2);
    emit('storyinit');
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  it('on() throws for unknown event names', () => {
    expect(() => on('badEvent' as any, vi.fn())).toThrow(
      'spindle: Unknown event "badEvent"',
    );
  });

  it('emit() is a no-op for events with no listeners', () => {
    expect(() => emit('storyinit')).not.toThrow();
  });

  it('afternavigate passes (to, from) args', () => {
    const cb = vi.fn();
    on('afternavigate', cb);
    emit('afternavigate', 'Room', 'Start');
    expect(cb).toHaveBeenCalledWith('Room', 'Start');
  });

  it('resetEmitter() clears all listeners', () => {
    const cb = vi.fn();
    on('storyinit', cb);
    resetEmitter();
    emit('storyinit');
    expect(cb).not.toHaveBeenCalled();
  });
});
