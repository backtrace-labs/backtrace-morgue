import type {Config} from '../config';
import type {ErrorCommand,
  CommandHandler,
} from '../cli/generated/types';

function handleError(cmd: ErrorCommand, config: Config): any {
  throw Error(cmd.message);
}

export const handlers: Record<string, CommandHandler> = {
  error: handleError,
};
