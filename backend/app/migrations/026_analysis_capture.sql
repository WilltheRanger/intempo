-- What the phone's microphone applied to a take, as the device reported it.
--
-- The app asks for raw audio — auto-gain, noise suppression and echo
-- cancellation off — because each of them moves an attack and attacks are what
-- the analysis measures. Nothing ever checked the request was honoured. A
-- browser that refuses it gets a retry with its defaults, which is voice
-- processing on; a browser that accepts it may apply processing anyway. Either
-- way the take carried no mark of it, and every real take so far detects far
-- more attacks than its page writes — a fault processing could cause and that
-- could not be ruled in or out from anything stored.
--
-- jsonb rather than six columns because nothing queries it by field and
-- nothing in the pipeline reads it: it is a report for whoever is diagnosing a
-- take, and its shape is the client's to extend without a migration each time.
-- Nullable, because a picked file, the native recorder and every older client
-- have nothing to say, and "not asked" must stay distinguishable from a report
-- whose every field is unknown.
alter table public.analyses
  add column if not exists capture jsonb;

comment on column public.analyses.capture is
  'Microphone processing the device reported for this take: auto_gain_control, '
  'noise_suppression, echo_cancellation (null = device did not say), '
  'sample_rate, channel_count, fell_back (raw request refused, defaults used). '
  'Null when the client did not report. Diagnostic only; never read by the '
  'pipeline.';
