export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: {
      artists: {
        Row: {
          genre: string | null;
          id: string;
          image_url: string | null;
          name: string;
        };
        Insert: {
          genre?: string | null;
          id?: string;
          image_url?: string | null;
          name: string;
        };
        Update: {
          genre?: string | null;
          id?: string;
          image_url?: string | null;
          name?: string;
        };
      };
      chat_messages: {
        Row: {
          body: string;
          client_message_id: string;
          group_id: string;
          id: string;
          sender_user_id: string;
          sent_at_client: string;
          sent_at_server: string;
          transport_type: string;
        };
        Insert: {
          body: string;
          client_message_id: string;
          group_id: string;
          id?: string;
          sender_user_id: string;
          sent_at_client: string;
          sent_at_server?: string;
          transport_type?: string;
        };
        Update: {
          body?: string;
          client_message_id?: string;
          group_id?: string;
          id?: string;
          sender_user_id?: string;
          sent_at_client?: string;
          sent_at_server?: string;
          transport_type?: string;
        };
      };
      festivals: {
        Row: {
          end_date: string;
          id: string;
          map_asset_url: string | null;
          name: string;
          start_date: string;
          timezone: string;
          venue_name: string | null;
          version: number;
        };
        Insert: {
          end_date: string;
          id?: string;
          map_asset_url?: string | null;
          name: string;
          start_date: string;
          timezone: string;
          venue_name?: string | null;
          version?: number;
        };
        Update: {
          end_date?: string;
          id?: string;
          map_asset_url?: string | null;
          name?: string;
          start_date?: string;
          timezone?: string;
          venue_name?: string | null;
          version?: number;
        };
      };
      group_invite_generations: {
        Row: {
          generated_at: string;
          group_id: string;
          id: string;
          requested_by_user_id: string;
        };
        Insert: {
          generated_at?: string;
          group_id: string;
          id?: string;
          requested_by_user_id: string;
        };
        Update: {
          generated_at?: string;
          group_id?: string;
          id?: string;
          requested_by_user_id?: string;
        };
      };
      group_members: {
        Row: {
          group_id: string;
          id: string;
          joined_at: string;
          role: string;
          user_id: string;
        };
        Insert: {
          group_id: string;
          id?: string;
          joined_at?: string;
          role?: string;
          user_id: string;
        };
        Update: {
          group_id?: string;
          id?: string;
          joined_at?: string;
          role?: string;
          user_id?: string;
        };
      };
      groups: {
        Row: {
          created_at: string;
          created_by_user_id: string;
          festival_id: string;
          id: string;
          invite_code: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          created_by_user_id: string;
          festival_id: string;
          id?: string;
          invite_code: string;
          name: string;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string;
          festival_id?: string;
          id?: string;
          invite_code?: string;
          name?: string;
        };
      };
      location_shares: {
        Row: {
          accuracy: number | null;
          group_id: string;
          heading: number | null;
          id: string;
          lat: number;
          lng: number;
          recorded_at: string;
          user_id: string;
        };
        Insert: {
          accuracy?: number | null;
          group_id: string;
          heading?: number | null;
          id?: string;
          lat: number;
          lng: number;
          recorded_at?: string;
          user_id: string;
        };
        Update: {
          accuracy?: number | null;
          group_id?: string;
          heading?: number | null;
          id?: string;
          lat?: number;
          lng?: number;
          recorded_at?: string;
          user_id?: string;
        };
      };
      meetups: {
        Row: {
          created_by_user_id: string;
          custom_map_x: number | null;
          custom_map_y: number | null;
          group_id: string;
          id: string;
          notes: string | null;
          stage_id: string | null;
          starts_at: string;
          title: string;
          totem_image_url: string | null;
        };
        Insert: {
          created_by_user_id: string;
          custom_map_x?: number | null;
          custom_map_y?: number | null;
          group_id: string;
          id?: string;
          notes?: string | null;
          stage_id?: string | null;
          starts_at: string;
          title: string;
          totem_image_url?: string | null;
        };
        Update: {
          created_by_user_id?: string;
          custom_map_x?: number | null;
          custom_map_y?: number | null;
          group_id?: string;
          id?: string;
          notes?: string | null;
          stage_id?: string | null;
          starts_at?: string;
          title?: string;
          totem_image_url?: string | null;
        };
      };
      sets: {
        Row: {
          artist_id: string;
          end_time: string;
          festival_id: string;
          id: string;
          set_type: string;
          stage_id: string;
          start_time: string;
        };
        Insert: {
          artist_id: string;
          end_time: string;
          festival_id: string;
          id?: string;
          set_type?: string;
          stage_id: string;
          start_time: string;
        };
        Update: {
          artist_id?: string;
          end_time?: string;
          festival_id?: string;
          id?: string;
          set_type?: string;
          stage_id?: string;
          start_time?: string;
        };
      };
      stages: {
        Row: {
          festival_id: string;
          id: string;
          map_x: number | null;
          map_y: number | null;
          name: string;
          zone: string | null;
        };
        Insert: {
          festival_id: string;
          id?: string;
          map_x?: number | null;
          map_y?: number | null;
          name: string;
          zone?: string | null;
        };
        Update: {
          festival_id?: string;
          id?: string;
          map_x?: number | null;
          map_y?: number | null;
          name?: string;
          zone?: string | null;
        };
      };
      user_set_selections: {
        Row: {
          festival_id: string;
          id: string;
          note: string | null;
          selected_at: string;
          set_id: string;
          user_id: string;
        };
        Insert: {
          festival_id: string;
          id?: string;
          note?: string | null;
          selected_at?: string;
          set_id: string;
          user_id: string;
        };
        Update: {
          festival_id?: string;
          id?: string;
          note?: string | null;
          selected_at?: string;
          set_id?: string;
          user_id?: string;
        };
      };
      users: {
        Row: {
          avatar_type: string;
          avatar_value: string;
          created_at: string;
          display_name: string;
          email: string;
          id: string;
        };
        Insert: {
          avatar_type?: string;
          avatar_value?: string;
          created_at?: string;
          display_name: string;
          email: string;
          id?: string;
        };
        Update: {
          avatar_type?: string;
          avatar_value?: string;
          created_at?: string;
          display_name?: string;
          email?: string;
          id?: string;
        };
      };
    };
    Views: Record<string, never>;
    Functions: {
      current_app_user_id: {
        Args: Record<string, never>;
        Returns: string | null;
      };
    };
    Enums: Record<string, never>;
  };
}
