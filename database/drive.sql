--
-- Drive: the staff file store. Bytes live in the private bucket (lib/vault/storage.ts), served only
-- through short-lived signed URLs. The Gallery is a system folder listed from gallery_images/videos.
--


--
-- Name: drive_folders; Type: TABLE; Schema: public; Owner: -
-- visibility: private (owner + shares) | team (every admin with drive:read) | shared (owner + shares).
--

CREATE TABLE public.drive_folders (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    parent_id uuid,
    name character varying(160) NOT NULL,
    owner_admin_id uuid,
    visibility character varying(10) DEFAULT 'private'::character varying NOT NULL,
    system_key character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: drive_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drive_files (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    folder_id uuid,
    name character varying(255) NOT NULL,
    mime_type character varying(120) NOT NULL,
    kind character varying(12) NOT NULL,
    size_bytes bigint DEFAULT 0 NOT NULL,
    storage_key text NOT NULL,
    thumbnail_key text,
    width integer,
    height integer,
    duration_seconds numeric(10,2),
    blurhash character varying(64),
    sha256 character varying(64),
    source character varying(16) DEFAULT 'upload'::character varying NOT NULL,
    uploaded_by_admin_id uuid,
    uploaded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: drive_shares; Type: TABLE; Schema: public; Owner: -
-- One grant on a folder or a file, to one admin or to everyone with a role.
--

CREATE TABLE public.drive_shares (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    folder_id uuid,
    file_id uuid,
    grantee_admin_id uuid,
    grantee_role character varying(50),
    level character varying(10) DEFAULT 'view'::character varying NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: drive_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.drive_access_log (
    id bigint NOT NULL,
    file_id uuid,
    folder_id uuid,
    admin_id uuid,
    user_id uuid,
    action character varying(16) NOT NULL,
    ip_net character varying(64),
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: drive_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.drive_access_log_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.drive_access_log_id_seq OWNED BY public.drive_access_log.id;
ALTER TABLE ONLY public.drive_access_log ALTER COLUMN id SET DEFAULT nextval('public.drive_access_log_id_seq'::regclass);
