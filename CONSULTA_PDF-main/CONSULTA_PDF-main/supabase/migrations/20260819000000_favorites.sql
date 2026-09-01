alter table documents
  add column is_favorite boolean not null default false;

create index idx_documents_is_favorite on documents (is_favorite) where is_favorite;
