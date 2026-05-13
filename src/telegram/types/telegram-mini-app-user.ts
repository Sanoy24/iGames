export type TelegramMiniAppUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  photo_url?: string;
  is_premium?: boolean;
};

export type ValidatedTelegramMiniAppData = {
  authDate: Date;
  queryId?: string;
  startParam?: string;
  user: TelegramMiniAppUser;
};
