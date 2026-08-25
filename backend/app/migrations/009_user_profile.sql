-- =============================================================
-- 009_user_profile — who the musician is, and what they play
-- =============================================================
--
-- Signing up produced a row with an email and nothing else. The app had no
-- name to greet anyone by, no picture, and — the one that actually changes
-- what the app does — no idea which instrument was being played.
--
-- **The instrument moves from the device to the account.** It has lived in
-- AsyncStorage (`intempo.preferences.v1`), defaulting to violin, since the
-- preferences module was written. That was a reasonable default with a visible
-- correction: the warmup names the instrument it is written for, so a violist
-- sees at once that it needs changing. What it cannot survive is a second
-- device. Sign in on a phone after setting up on the web and you are silently
-- back on violin — and a double bassist gets a treble warmup with no clue why.
-- It is also the value `analyses.instrument` records for every take (008), so
-- the server has been trusting the client to tell it something the account
-- should have known.

-- Nullable, and that is the whole point: NULL means **nobody has been asked
-- yet**, which is not the same as any of the four answers.
--
-- The same rule `ScoreJson.clef` follows, and for the same reason it was
-- written down: defaulting an unknown to the commonest value produces an
-- answer that is indistinguishable from a stated one. A row that says
-- 'violin' should mean a person chose violin. Existing rows predate the
-- question, so they get NULL and the app keeps using the device preference
-- for them until they are asked.
ALTER TABLE users ADD COLUMN instrument text
  CHECK (instrument IN ('violin', 'viola', 'cello', 'double_bass'));

-- What to call them. Not `name` — a display name is the one they chose to be
-- called, which is not necessarily their legal name and is not unique.
--
-- Length matches `scores.title`'s reasoning: long enough for a real name with
-- diacritics, short enough that nothing downstream has to truncate.
ALTER TABLE users ADD COLUMN display_name text
  CHECK (display_name IS NULL OR length(display_name) BETWEEN 1 AND 80);

-- The object key of the profile picture in the `avatars` bucket, not a URL.
--
-- Keys, not URLs, for the reason `scores.source_image_url` learned the hard
-- way: a signed URL expires, so storing one means storing something that stops
-- working. The API signs a fresh one per response.
ALTER TABLE users ADD COLUMN avatar_key text;

-- When they finished — or skipped — the one onboarding screen.
--
-- **A timestamp rather than a boolean**, because "have they been asked" and
-- "did they answer" are different questions and only the first one decides
-- whether to show the screen. Someone who skips is onboarded: they were asked
-- and they declined, and asking again every launch is how a skippable screen
-- stops being skippable.
ALTER TABLE users ADD COLUMN onboarded_at timestamptz;

COMMENT ON COLUMN users.instrument IS
  'What they play. NULL means not asked yet — never defaulted, so a stated answer is distinguishable from an assumed one.';
COMMENT ON COLUMN users.display_name IS
  'What to call them. NULL until onboarding, and NULL is a legitimate final answer for someone who skipped.';
COMMENT ON COLUMN users.avatar_key IS
  'Object key in the avatars bucket. Not a URL — signed URLs expire, so a stored one stops working.';
COMMENT ON COLUMN users.onboarded_at IS
  'When the onboarding screen was completed or skipped. Set either way: being asked is what it records.';

-- =============================================================
-- avatars bucket
-- =============================================================
--
-- Separate from `score-images` because the two have opposite lifetimes and
-- opposite audiences. A page photograph is transient — it exists to be read
-- and is deleted when the reading is accepted. An avatar persists for the life
-- of the account, and is the one object here that another person is ever
-- meant to see, once the teacher tier lands.
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', false)
ON CONFLICT (id) DO NOTHING;

-- Same shape as the score-images policies in 002: the object key is prefixed
-- with the owner's user id, and the policy compares that prefix to the caller.
-- Anything else lets one account write over another's picture by guessing a
-- key, which is the whole attack.
CREATE POLICY "avatars are readable by their owner"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars are writable by their owner"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars are replaceable by their owner"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars are deletable by their owner"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
