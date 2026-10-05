-- 009_seed_moderation_terms.sql
--
-- Starter list for private.contains_disallowed_text(): whole-word,
-- case-insensitive matches block display names, group names and meetup
-- titles/notes (P0001 content_not_allowed). Data only; safe to re-run.
--
-- Curated from common open-source moderation word lists. Words that are also
-- everyday words or common names (e.g. "dick", "cock", "pussy", "cum", "negro",
-- "dyke", "coon", "prick", "homo") are deliberately left out because matching
-- is whole-word and would block legitimate names. Inflected forms are listed
-- explicitly because matching is whole-word.
--
-- Extend with: npm run admin -- moderation:add-terms <term...>
-- (see docs/festival-data.md, "Moderation").

insert into public.moderation_terms (term)
values
  -- profanity
  ('fuck'), ('fucks'), ('fucked'), ('fucker'), ('fuckers'), ('fucking'), ('fuckin'),
  ('fuckface'), ('fuckhead'), ('fuckwit'), ('motherfucker'), ('motherfuckers'),
  ('motherfucking'), ('mofo'), ('stfu'), ('gtfo'),
  ('shit'), ('shits'), ('shitty'), ('shithead'), ('shitheads'), ('shitface'),
  ('bullshit'), ('horseshit'), ('dipshit'), ('apeshit'),
  ('cunt'), ('cunts'),
  ('bitch'), ('bitches'), ('bitchy'),
  ('asshole'), ('assholes'), ('arsehole'), ('arseholes'),
  ('dickhead'), ('dickheads'), ('douchebag'), ('douchebags'),
  ('bastard'), ('bastards'),
  ('twat'), ('twats'), ('wanker'), ('wankers'), ('tosser'),
  ('cocksucker'), ('cocksuckers'),
  ('slut'), ('sluts'), ('slutty'), ('whore'), ('whores'), ('skank'), ('skanks'),
  -- sexual content
  ('jizz'), ('cumshot'), ('blowjob'), ('blowjobs'), ('handjob'), ('rimjob'),
  ('dildo'), ('dildos'), ('porn'), ('porno'), ('titties'), ('milf'), ('gangbang'),
  -- sexual violence
  ('rape'), ('raped'), ('rapes'), ('raping'), ('rapist'), ('rapists'),
  -- hate symbols and slogans
  ('nazi'), ('nazis'), ('kkk'), ('1488'), ('sieg heil'), ('white power'),
  -- racial and ethnic slurs
  ('nigger'), ('niggers'), ('nigga'), ('niggas'), ('sandnigger'),
  ('chink'), ('chinks'), ('gook'), ('gooks'), ('zipperhead'),
  ('spic'), ('spics'), ('wetback'), ('wetbacks'), ('beaner'), ('beaners'),
  ('kike'), ('kikes'), ('raghead'), ('ragheads'), ('towelhead'), ('towelheads'),
  ('jigaboo'), ('porch monkey'), ('darkie'), ('darkies'), ('golliwog'),
  ('paki'), ('pakis'), ('gyppo'), ('gypo'), ('pikey'), ('redskin'), ('redskins'),
  -- homophobic and transphobic slurs
  ('fag'), ('fags'), ('faggot'), ('faggots'), ('tranny'), ('trannies'), ('shemale'),
  -- ableist slurs
  ('retard'), ('retards'), ('retarded'), ('mongoloid')
on conflict (term) do nothing;
