import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),
  PORT: Joi.number().default(3000),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: Joi.string().email(), //.required(),
  GOOGLE_PRIVATE_KEY: Joi.string(), //.required(),
});
