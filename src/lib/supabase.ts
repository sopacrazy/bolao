import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dxvvpuhbtypsxmthcljg.supabase.co';
export const supabaseKey = 'sb_publishable_DSGOvumhRbDot04E1wwnbA_fRd_y8H9';
export const supabaseAdminToken = 'sbp_5064887a2c8f1fe935bc1c634fbfd6c510419a73';

export const supabase = createClient(supabaseUrl, supabaseKey);
