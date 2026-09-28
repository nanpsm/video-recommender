create table if not exists user_genre_profiles (
  user_id integer not null,
  genre   text    not null,
  score   real    not null,
  primary key (user_id, genre)
);

alter table user_genre_profiles enable row level security;

create policy "public read" on user_genre_profiles
  for select using (true);
