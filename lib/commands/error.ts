import type {Config} from '../config';
import type {ErrorCommand,
  CommandHandler,
  CommandHandlerMap,
} from '../cli/generated/types';

function handleError(cmd: ErrorCommand, config: Config): any {
  throw Error(cmd.message);
}

export const handlers = {
  error: handleError,
} satisfies Partial<CommandHandlerMap>;
