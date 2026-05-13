import { Request } from 'express';

export type AuthenticatedUser = {
  id: string;
  roles: string[];
  sessionId?: string;
};

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};
