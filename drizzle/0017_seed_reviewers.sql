-- Initial reviewer roster. Conflict-safe so deploying again won't overwrite edits or restore removed reviewers.
INSERT INTO "reviewers" ("slack_id", "email", "name") VALUES
  ('U079YUX7220', 'lennynoahkay@gmail.com', 'Lenny'),
  ('U07LKN2HXT3', 'obay.developer@gmail.com', 'Obay'),
  ('U087BHR98AX', 'maracuchoamericano@gmail.com', 'Sebastian (plastuchino)'),
  ('U0BEEDP0RL6', 'sebastianhernandez@hackclub.com', 'Sebastian Hernandez-Tavares'),
  ('U089A0UH848', 'khanalaastha88@gmail.com', 'Aastha Khanal'),
  ('U090254RL9L', 'owais12@codeday.org', 'owais'),
  ('U098H19L3RC', 'bluzed.js@gmail.com', 'person'),
  ('U09B3S7TZ4N', 'singhal.hiral@gmail.com', 'Hiral Singhal'),
  ('U09HQH0PNEN', 'heyyitsmeaditya@gmail.com', 'agm (Aditya Singh)'),
  ('U0A17JG84G6', 'Dsairohan@gmail.com', 'Rohan'),
  ('U0BBENCGGG4', 'divyakishor0001@gmail.com', 'Vivid'),
  ('U0BF21VQ0V8', 'np.arkhanal@gmail.com', 'Arjun Khanal')
ON CONFLICT ("slack_id") DO NOTHING;
