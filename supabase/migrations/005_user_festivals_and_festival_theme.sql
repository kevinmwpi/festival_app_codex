-- Add theme columns to festivals
ALTER TABLE public.festivals
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#B2CEFE',
  ADD COLUMN IF NOT EXISTS image_url text;

-- Create user_festivals join table
CREATE TABLE IF NOT EXISTS public.user_festivals (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  festival_id uuid NOT NULL REFERENCES public.festivals(id) ON DELETE CASCADE,
  selected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, festival_id)
);

-- Enable RLS
ALTER TABLE public.user_festivals ENABLE ROW LEVEL SECURITY;

-- RLS policies for user_festivals
CREATE POLICY "Users can view their own festival selections"
  ON public.user_festivals FOR SELECT
  USING (user_id = public.current_app_user_id());

CREATE POLICY "Users can insert their own festival selections"
  ON public.user_festivals FOR INSERT
  WITH CHECK (user_id = public.current_app_user_id());

CREATE POLICY "Users can delete their own festival selections"
  ON public.user_festivals FOR DELETE
  USING (user_id = public.current_app_user_id());
