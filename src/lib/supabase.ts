import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://dxvvpuhbtypsxmthcljg.supabase.co';
const supabaseKey = 'sb_publishable_DSGOvumhRbDot04E1wwnbA_fRd_y8H9';

export const supabase = createClient(supabaseUrl, supabaseKey);
