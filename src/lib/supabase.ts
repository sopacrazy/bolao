import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dxvvpuhbtypsxmthcljg.supabase.co';
export const supabaseKey = 'sb_publishable_DSGOvumhRbDot04E1wwnbA_fRd_y8H9';
export const supabaseAdminToken = 'sbp_460db20ffb4ce83d2b1d49fb973e70df5e544b4d';

export const supabase = createClient(supabaseUrl, supabaseKey);
