import { ResourceLockedError, ExecutionError } from 'redlock';
import { RedisLockService } from './redis-lock.service';

/**
 * The Redlock 'error' handler is pure observability, but getting it wrong is
 * expensive: it used to filter contention by matching the message text
 * `'was not granted'`, which is redlock v4 wording. On the v5 actually installed,
 * ordinary contention reads "The operation was applied to: 0 of the 1 requested
 * resources", so nothing was ever filtered and the error log filled at roughly
 * ten lines a second - burying the one real error ("Table 'bingo_configs'
 * doesn't exist") that explained why the Bingo bot buy-in gate was inert.
 *
 * These tests pin the behaviour to the error TYPE rather than its wording, so a
 * redlock upgrade that rephrases the message cannot quietly break it again.
 */
describe('RedisLockService  Redlock error handling', () => {
    function makeService() {
        const handlers: Array<(err: Error) => void> = [];
        const redis = { status: 'ready' } as never;
        const service = new RedisLockService(redis);
        // Capture the handler the constructor registered on the real Redlock.
        const redlock = (service as unknown as { redlock: unknown })
            .redlock as {
            listeners: (event: string) => Array<(err: Error) => void>;
        };
        handlers.push(...redlock.listeners('error'));
        const logger = (service as unknown as { logger: { error: unknown } })
            .logger;
        const errorSpy = jest
            .spyOn(logger as { error: (m: string) => void }, 'error')
            .mockImplementation(() => undefined);
        const emit = (err: Error) => handlers.forEach((h) => h(err));
        return { service, emit, errorSpy };
    }

    // The exact error redlock v5 emits when another holder has the lock.
    const contention = () =>
        new ResourceLockedError(
            'The operation was applied to: 0 of the 1 requested resources.',
        );

    it('stays silent for ordinary lock contention, whatever the message says', () => {
        const { emit, errorSpy } = makeService();

        for (let i = 0; i < 50; i += 1) emit(contention());

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('does not depend on the message text to recognise contention', () => {
        const { emit, errorSpy } = makeService();

        // A future redlock could reword this freely; the type is what matters.
        emit(new ResourceLockedError('something else entirely'));

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it('still reports a genuine fault', () => {
        const { emit, errorSpy } = makeService();

        emit(
            new ExecutionError(
                'The operation was unable to achieve a quorum during its retry window.',
                [],
            ),
        );

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(String(errorSpy.mock.calls[0][0])).toContain('quorum');
    });

    it('throttles a repeating fault instead of flooding, and says how many it held back', () => {
        const { emit, errorSpy } = makeService();
        const fault = () => new ExecutionError('redis unreachable', []);

        for (let i = 0; i < 200; i += 1) emit(fault());

        // One line for the burst, not two hundred.
        expect(errorSpy).toHaveBeenCalledTimes(1);

        // The next one outside the window reports what was swallowed, so a
        // sustained fault can never look like a single blip.
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 60_000);
        emit(fault());
        expect(errorSpy).toHaveBeenCalledTimes(2);
        expect(String(errorSpy.mock.calls[1][0])).toContain('+199 more');
        jest.restoreAllMocks();
    });

    it('never lets contention consume the throttle budget for real faults', () => {
        const { emit, errorSpy } = makeService();

        for (let i = 0; i < 100; i += 1) emit(contention());
        emit(new ExecutionError('redis unreachable', []));

        expect(errorSpy).toHaveBeenCalledTimes(1);
    });
});
