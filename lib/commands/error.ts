import type {ErrorCommand} from '../cli/generated/types';

function handleError(cmd: ErrorCommand, config: any): any {
  throw Error(cmd.message);
}

export const handlers: Record<string, (cmd: any, config: any) => any> = {
  error: handleError,
};
