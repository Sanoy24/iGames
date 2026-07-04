import { Request } from 'express';

export type AuthenticatedUser = {
  id: string;
  roles: string[];
  operatorId?: string | null;
  sessionId?: string;
};

export type AuthenticatedRequest = Request & {
  user: AuthenticatedUser;
};
