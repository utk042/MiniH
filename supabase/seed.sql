-- ---------------------------------------------------------------------------
-- BACKSTACK seed
--
-- 25 students, 61 canonical books, 73 copies, 61 wants.
--
-- Three trades are constructed by hand so the demo never depends on luck:
--
--   3-way   ada.chen -> bo.mensah -> cy.okafor -> ada.chen
--   4-way   dee.laurent -> eli.novak -> fern.abbott -> gus.iversen -> dee.laurent
--   2-way   hana.suzuki <-> ike.brennan
--
-- Plus, deliberately:
--   * kira.osei <-> jun.park       an edition-tolerant cycle (1st ed fills a
--                                  want for the 2nd ed)
--   * lena.ortiz                   a strict-edition want that must NOT match
--                                  the 8th edition sitting on mo.hassan's shelf
--   * nia.walsh                    holds books other people want, but nothing
--                                  leads back to her inside four hops, so her
--                                  want resolves to a cash offer
--
-- The remaining students carry organic shelves and wants, which produce extra
-- unplanned cycles. That is intentional: a match list containing only the
-- three staged trades would look staged.
--
-- User ids are md5-derived from the handle, so the whole file is deterministic
-- and re-runnable against a fresh database.
-- ---------------------------------------------------------------------------

begin;

-- --- students ---------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new
)
select
  '00000000-0000-0000-0000-000000000000',
  md5('backstack:' || s.local_part)::uuid,
  'authenticated',
  'authenticated',
  s.local_part || '@' || public.allowed_email_domain(),
  '',
  now() - (s.ord || ' days')::interval,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', s.display_name, 'pickup_spot', s.pickup_spot),
  now() - (s.ord || ' days')::interval,
  now() - (s.ord || ' days')::interval,
  '', '', '', ''
from (values
  ('ada.chen',        'Ada Chen',           'Ellery Hall lobby',        1),
  ('bo.mensah',       'Bo Mensah',          'Science Library, 2nd fl',  2),
  ('cy.okafor',       'Cy Okafor',          'Union coffee bar',         3),
  ('dee.laurent',     'Dee Laurent',        'Cardwell mailroom',        4),
  ('eli.novak',       'Eli Novak',          'Physics building atrium',  5),
  ('fern.abbott',     'Fern Abbott',        'Humanities quad benches',  6),
  ('gus.iversen',     'Gus Iversen',        'North gate bike racks',    7),
  ('hana.suzuki',     'Hana Suzuki',        'Math lounge, Wren 300',    8),
  ('ike.brennan',     'Ike Brennan',        'CS help desk',             9),
  ('jun.park',        'Jun Park',           'Ellery Hall lobby',       10),
  ('kira.osei',       'Kira Osei',          'Observatory steps',       11),
  ('lena.ortiz',      'Lena Ortiz',         'Union coffee bar',        12),
  ('mo.hassan',       'Mo Hassan',          'Wren Hall front desk',    13),
  ('nia.walsh',       'Nia Walsh',          'Business school lobby',   14),
  ('omar.diallo',     'Omar Diallo',        'Business school lobby',   15),
  ('pia.lindqvist',   'Pia Lindqvist',      'Chem stockroom window',   16),
  ('quinn.reyes',     'Quinn Reyes',        'Track locker rooms',      17),
  ('ravi.sundaram',   'Ravi Sundaram',      'CS help desk',            18),
  ('sara.mbeki',      'Sara Mbeki',         'Biology greenhouse',      19),
  ('tomas.vega',      'Tomas Vega',         'Cardwell mailroom',       20),
  ('uma.krishnan',    'Uma Krishnan',       'Med campus shuttle stop', 21),
  ('viv.arnold',      'Viv Arnold',         'Humanities quad benches', 22),
  ('wes.duplantis',   'Wes Duplantis',      'North gate bike racks',   23),
  ('xochitl.rivera',  'Xochitl Rivera',     'Art building steps',      24),
  ('yara.haddad',     'Yara Haddad',        'Science Library, 2nd fl', 25)
) as s(local_part, display_name, pickup_spot, ord);

-- --- books ------------------------------------------------------------------
insert into public.books (
  canonical_key, work_key, title, authors, edition_number, edition_label,
  subject_tags, course_codes, list_price_cents, source
)
select
  b.canonical_key, b.work_key, b.title, b.authors, b.edition_number,
  case when b.edition_number is null then null
       else b.edition_number::text ||
            case b.edition_number % 100
              when 11 then 'th' when 12 then 'th' when 13 then 'th'
              else case b.edition_number % 10
                     when 1 then 'st' when 2 then 'nd' when 3 then 'rd'
                     else 'th' end
            end || ' ed.'
  end,
  b.subject_tags, b.course_codes, b.list_price_cents, 'seed'
from (values
  -- key                                                 work_key                                          title                                                   authors                                                                                   ed   subject_tags                                                                   course_codes            list
  ('morrison-boyd-organic-chemistry-3',                  'morrison-boyd-organic-chemistry',                'Organic Chemistry',                                    array['Robert T. Morrison','Robert N. Boyd'],                                              3, array['chemistry','organic-chemistry','upper-division','edition-sensitive'],   array['CHEM 241'],      18500),
  ('mcmurry-organic-chemistry-9',                        'mcmurry-organic-chemistry',                      'Organic Chemistry',                                    array['John E. McMurry'],                                                                  9, array['chemistry','organic-chemistry','upper-division'],                        array['CHEM 241'],      29900),
  ('brown-chemistry-the-central-science-14',             'brown-chemistry-the-central-science',            'Chemistry: The Central Science',                       array['Theodore L. Brown','H. Eugene LeMay','Bruce E. Bursten'],                          14, array['chemistry','intro-level','lab-required'],                                array['CHEM 101'],      27500),
  ('atkins-physical-chemistry-11',                       'atkins-physical-chemistry',                      'Physical Chemistry',                                   array['Peter Atkins','Julio de Paula'],                                                   11, array['chemistry','physical-chemistry','upper-division'],                       array['CHEM 331'],      31000),
  ('zumdahl-chemical-principles-8',                      'zumdahl-chemical-principles',                    'Chemical Principles',                                  array['Steven S. Zumdahl','Donald J. DeCoste'],                                            8, array['chemistry','intro-level'],                                               array['CHEM 102'],      24000),
  ('axler-linear-algebra-done-right-4',                  'axler-linear-algebra-done-right',                'Linear Algebra Done Right',                            array['Sheldon Axler'],                                                                    4, array['mathematics','linear-algebra','upper-division'],                         array['MATH 214'],       5900),
  ('hoffman-kunze-linear-algebra-2',                     'hoffman-kunze-linear-algebra',                   'Linear Algebra',                                       array['Kenneth Hoffman','Ray Kunze'],                                                      2, array['mathematics','linear-algebra','upper-division'],                         array['MATH 214'],      12000),
  ('stewart-calculus-early-transcendentals-8',           'stewart-calculus-early-transcendentals',         'Calculus: Early Transcendentals',                      array['James Stewart'],                                                                    8, array['mathematics','calculus','intro-level','edition-sensitive'],              array['MATH 121'],      28000),
  ('stewart-calculus-early-transcendentals-9',           'stewart-calculus-early-transcendentals',         'Calculus: Early Transcendentals',                      array['James Stewart','Daniel Clegg','Saleem Watson'],                                     9, array['mathematics','calculus','intro-level','edition-sensitive'],              array['MATH 121'],      31500),
  ('spivak-calculus-4',                                  'spivak-calculus',                                'Calculus',                                             array['Michael Spivak'],                                                                   4, array['mathematics','calculus','upper-division'],                               array['MATH 131'],       9500),
  ('rudin-principles-of-mathematical-analysis-3',        'rudin-principles-of-mathematical-analysis',      'Principles of Mathematical Analysis',                  array['Walter Rudin'],                                                                     3, array['mathematics','real-analysis','upper-division'],                          array['MATH 351'],      15500),
  ('strogatz-nonlinear-dynamics-and-chaos-2',            'strogatz-nonlinear-dynamics-and-chaos',          'Nonlinear Dynamics and Chaos',                         array['Steven H. Strogatz'],                                                               2, array['mathematics','dynamical-systems','upper-division'],                      array['MATH 372'],       8900),
  ('ross-a-first-course-in-probability-10',              'ross-a-first-course-in-probability',             'A First Course in Probability',                        array['Sheldon Ross'],                                                                    10, array['mathematics','probability','intro-level'],                               array['STAT 201'],      21000),
  ('casella-berger-statistical-inference-2',             'casella-berger-statistical-inference',           'Statistical Inference',                                array['George Casella','Roger L. Berger'],                                                 2, array['statistics','upper-division','grad-level'],                              array['STAT 411'],      19000),
  ('openstax-university-physics-volume-1-1',             'openstax-university-physics-volume-1',           'University Physics, Volume 1',                         array['Samuel J. Ling','Jeff Sanny','William Moebs'],                                      1, array['physics','mechanics','intro-level','open-access'],                       array['PHYS 121'],       4000),
  ('openstax-university-physics-volume-1-2',             'openstax-university-physics-volume-1',           'University Physics, Volume 1',                         array['Samuel J. Ling','Jeff Sanny','William Moebs'],                                      2, array['physics','mechanics','intro-level','open-access'],                       array['PHYS 121'],       4500),
  ('griffiths-introduction-to-electrodynamics-4',        'griffiths-introduction-to-electrodynamics',      'Introduction to Electrodynamics',                      array['David J. Griffiths'],                                                               4, array['physics','electromagnetism','upper-division'],                           array['PHYS 331'],      18000),
  ('taylor-classical-mechanics-1',                       'taylor-classical-mechanics',                     'Classical Mechanics',                                  array['John R. Taylor'],                                                                   1, array['physics','mechanics','upper-division'],                                  array['PHYS 311'],      13500),
  ('sakurai-modern-quantum-mechanics-3',                 'sakurai-modern-quantum-mechanics',               'Modern Quantum Mechanics',                             array['J. J. Sakurai','Jim Napolitano'],                                                   3, array['physics','quantum-mechanics','grad-level'],                              array['PHYS 521'],      11000),
  ('serway-physics-for-scientists-and-engineers-10',     'serway-physics-for-scientists-and-engineers',    'Physics for Scientists and Engineers',                 array['Raymond A. Serway','John W. Jewett'],                                              10, array['physics','intro-level','lab-required'],                                  array['PHYS 122'],      29500),
  ('halliday-resnick-fundamentals-of-physics-11',        'halliday-resnick-fundamentals-of-physics',       'Fundamentals of Physics',                              array['David Halliday','Robert Resnick','Jearl Walker'],                                  11, array['physics','intro-level'],                                                 array['PHYS 121'],      28500),
  ('cormen-introduction-to-algorithms-4',                'cormen-introduction-to-algorithms',              'Introduction to Algorithms',                           array['Thomas H. Cormen','Charles E. Leiserson','Ronald L. Rivest','Clifford Stein'],      4, array['computer-science','algorithms','upper-division'],                        array['CS 310'],        13000),
  ('sipser-introduction-to-the-theory-of-computation-3', 'sipser-introduction-to-the-theory-of-computation','Introduction to the Theory of Computation',           array['Michael Sipser'],                                                                   3, array['computer-science','theory','upper-division'],                            array['CS 340'],        16500),
  ('silberschatz-operating-system-concepts-10',          'silberschatz-operating-system-concepts',         'Operating System Concepts',                            array['Abraham Silberschatz','Peter B. Galvin','Greg Gagne'],                             10, array['computer-science','systems','upper-division'],                           array['CS 350'],        17500),
  ('tanenbaum-computer-networks-6',                      'tanenbaum-computer-networks',                    'Computer Networks',                                    array['Andrew S. Tanenbaum','Nick Feamster','David J. Wetherall'],                         6, array['computer-science','networks','upper-division'],                          array['CS 360'],        16000),
  ('russell-norvig-artificial-intelligence-4',           'russell-norvig-artificial-intelligence',         'Artificial Intelligence: A Modern Approach',           array['Stuart Russell','Peter Norvig'],                                                    4, array['computer-science','artificial-intelligence','upper-division'],           array['CS 470'],        19500),
  ('skiena-the-algorithm-design-manual-3',               'skiena-the-algorithm-design-manual',             'The Algorithm Design Manual',                          array['Steven S. Skiena'],                                                                 3, array['computer-science','algorithms','interview-prep'],                        array['CS 310'],        6500),
  ('wooldridge-introductory-econometrics-7',             'wooldridge-introductory-econometrics',           'Introductory Econometrics: A Modern Approach',         array['Jeffrey M. Wooldridge'],                                                            7, array['economics','econometrics','upper-division'],                             array['ECON 320'],      24500),
  ('mankiw-principles-of-economics-9',                   'mankiw-principles-of-economics',                 'Principles of Economics',                              array['N. Gregory Mankiw'],                                                                9, array['economics','intro-level','edition-sensitive'],                           array['ECON 101'],      22000),
  ('varian-intermediate-microeconomics-9',               'varian-intermediate-microeconomics',             'Intermediate Microeconomics: A Modern Approach',       array['Hal R. Varian'],                                                                    9, array['economics','microeconomics','upper-division'],                           array['ECON 210'],      15000),
  ('krugman-international-economics-11',                 'krugman-international-economics',                'International Economics: Theory and Policy',           array['Paul R. Krugman','Maurice Obstfeld','Marc J. Melitz'],                             11, array['economics','international','upper-division'],                            array['ECON 340'],      23000),
  ('mishkin-economics-of-money-banking-12',              'mishkin-economics-of-money-banking',             'The Economics of Money, Banking and Financial Markets',array['Frederic S. Mishkin'],                                                             12, array['economics','finance','upper-division'],                                  array['ECON 330'],      25000),
  ('hull-options-futures-and-other-derivatives-11',      'hull-options-futures-and-other-derivatives',     'Options, Futures, and Other Derivatives',              array['John C. Hull'],                                                                    11, array['finance','derivatives','grad-level'],                                    array['FIN 420'],       26000),
  ('brealey-principles-of-corporate-finance-14',         'brealey-principles-of-corporate-finance',        'Principles of Corporate Finance',                      array['Richard A. Brealey','Stewart C. Myers','Franklin Allen'],                          14, array['finance','corporate-finance','upper-division'],                          array['FIN 310'],      27000),
  ('kotler-principles-of-marketing-18',                  'kotler-principles-of-marketing',                 'Principles of Marketing',                              array['Philip Kotler','Gary Armstrong'],                                                  18, array['business','marketing','intro-level'],                                    array['MKTG 201'],      23500),
  ('horngren-cost-accounting-17',                        'horngren-cost-accounting',                       'Cost Accounting: A Managerial Emphasis',               array['Charles T. Horngren','Srikant M. Datar','Madhav V. Rajan'],                        17, array['business','accounting','upper-division'],                                array['ACCT 310'],      28000),
  ('campbell-biology-12',                                'campbell-biology',                               'Campbell Biology',                                     array['Lisa A. Urry','Michael L. Cain','Steven A. Wasserman'],                            12, array['biology','intro-level','lab-required'],                                  array['BIOL 111'],      26000),
  ('sadava-life-the-science-of-biology-12',              'sadava-life-the-science-of-biology',             'Life: The Science of Biology',                         array['David E. Sadava','David M. Hillis'],                                               12, array['biology','intro-level'],                                                 array['BIOL 112'],      24500),
  ('alberts-molecular-biology-of-the-cell-7',            'alberts-molecular-biology-of-the-cell',          'Molecular Biology of the Cell',                        array['Bruce Alberts','Rebecca Heald','Alexander Johnson'],                                7, array['biology','cell-biology','upper-division'],                               array['BIOL 320'],      21000),
  ('lehninger-principles-of-biochemistry-8',             'lehninger-principles-of-biochemistry',           'Lehninger Principles of Biochemistry',                 array['David L. Nelson','Michael M. Cox'],                                                 8, array['biochemistry','upper-division','edition-sensitive'],                     array['BIOC 301'],      25500),
  ('griffiths-introduction-to-genetic-analysis-12',      'griffiths-introduction-to-genetic-analysis',     'Introduction to Genetic Analysis',                     array['Anthony J. F. Griffiths','John Doebley','Catherine Peichel'],                      12, array['biology','genetics','upper-division'],                                   array['BIOL 340'],      22500),
  ('purves-neuroscience-6',                              'purves-neuroscience',                            'Neuroscience',                                         array['Dale Purves','George J. Augustine'],                                                6, array['neuroscience','upper-division'],                                         array['NSCI 301'],      19500),
  ('kandel-principles-of-neural-science-6',              'kandel-principles-of-neural-science',            'Principles of Neural Science',                         array['Eric R. Kandel','John D. Koester'],                                                 6, array['neuroscience','grad-level'],                                             array['NSCI 501'],      13500),
  ('guyton-hall-textbook-of-medical-physiology-14',      'guyton-hall-textbook-of-medical-physiology',     'Guyton and Hall Textbook of Medical Physiology',       array['John E. Hall','Michael E. Hall'],                                                  14, array['physiology','pre-med','exam-prep'],                                      array['PHYL 301'],      11000),
  ('gray-anatomy-for-students-4',                        'gray-anatomy-for-students',                      'Gray''s Anatomy for Students',                         array['Richard L. Drake','A. Wayne Vogl','Adam W. M. Mitchell'],                           4, array['anatomy','pre-med','lab-required'],                                      array['ANAT 210'],      10500),
  ('myers-psychology-13',                                'myers-psychology',                               'Psychology',                                           array['David G. Myers','C. Nathan DeWall'],                                               13, array['psychology','intro-level'],                                              array['PSYC 101'],      21500),
  ('giddens-introduction-to-sociology-12',               'giddens-introduction-to-sociology',              'Introduction to Sociology',                            array['Anthony Giddens','Mitchell Duneier'],                                              12, array['sociology','intro-level'],                                               array['SOC 101'],      12500),
  ('macionis-society-the-basics-15',                     'macionis-society-the-basics',                    'Society: The Basics',                                  array['John J. Macionis'],                                                                15, array['sociology','intro-level'],                                               array['SOC 101'],      14000),
  ('norton-anthology-american-literature-b-9',           'norton-anthology-american-literature-b',         'The Norton Anthology of American Literature, Volume B', array['Robert S. Levine'],                                                                9, array['literature','american-literature','anthology'],                          array['ENGL 210'],       6500),
  ('norton-anthology-english-literature-a-10',           'norton-anthology-english-literature-a',          'The Norton Anthology of English Literature, Volume A',  array['Stephen Greenblatt'],                                                             10, array['literature','english-literature','anthology'],                           array['ENGL 220'],       7000),
  ('riverside-shakespeare-complete-works-2',             'riverside-shakespeare-complete-works',           'The Riverside Shakespeare',                            array['William Shakespeare','G. Blakemore Evans'],                                         2, array['literature','shakespeare','anthology'],                                  array['ENGL 315'],       9000),
  ('hacker-a-writers-reference-10',                      'hacker-a-writers-reference',                     'A Writer''s Reference',                                array['Diana Hacker','Nancy Sommers'],                                                    10, array['writing','intro-level','required-all-majors'],                           array['WRIT 101'],       6000),
  ('strunk-white-the-elements-of-style-4',               'strunk-white-the-elements-of-style',             'The Elements of Style',                                array['William Strunk Jr.','E. B. White'],                                                 4, array['writing','intro-level'],                                                 array['WRIT 101'],       1200),
  ('diaz-the-brief-wondrous-life-of-oscar-wao-1',        'diaz-the-brief-wondrous-life-of-oscar-wao',      'The Brief Wondrous Life of Oscar Wao',                 array['Junot Diaz'],                                                                       1, array['literature','contemporary-fiction'],                                     array['ENGL 245'],       1800),
  ('rawls-a-theory-of-justice-2',                        'rawls-a-theory-of-justice',                      'A Theory of Justice',                                  array['John Rawls'],                                                                       2, array['philosophy','political-theory','upper-division'],                        array['PHIL 340'],       4200),
  ('kant-critique-of-pure-reason-1',                     'kant-critique-of-pure-reason',                   'Critique of Pure Reason',                              array['Immanuel Kant','Paul Guyer','Allen W. Wood'],                                       1, array['philosophy','metaphysics','upper-division'],                             array['PHIL 320'],       5500),
  ('plato-republic-2',                                   'plato-republic',                                 'Republic',                                             array['Plato','G. M. A. Grube','C. D. C. Reeve'],                                          2, array['philosophy','ancient-philosophy','intro-level'],                         array['PHIL 101'],       1500),
  ('blackburn-think-1',                                  'blackburn-think',                                'Think: A Compelling Introduction to Philosophy',       array['Simon Blackburn'],                                                                  1, array['philosophy','intro-level'],                                              array['PHIL 101'],       2200),
  ('foner-give-me-liberty-7',                            'foner-give-me-liberty',                          'Give Me Liberty! An American History',                 array['Eric Foner'],                                                                       7, array['history','american-history','intro-level'],                              array['HIST 111'],       9500),
  ('tignor-worlds-together-worlds-apart-6',              'tignor-worlds-together-worlds-apart',            'Worlds Together, Worlds Apart',                        array['Robert Tignor','Jeremy Adelman'],                                                   6, array['history','world-history','intro-level'],                                 array['HIST 101'],       8800),
  ('hobsbawm-the-age-of-extremes-1',                     'hobsbawm-the-age-of-extremes',                   'The Age of Extremes: 1914-1991',                       array['Eric Hobsbawm'],                                                                    1, array['history','twentieth-century','upper-division'],                          array['HIST 340'],       2400)
) as b(canonical_key, work_key, title, authors, edition_number, subject_tags, course_codes, list_price_cents);

-- --- copies (the SHELF side of every profile) -------------------------------
insert into public.copies (owner_id, book_id, condition, notes, ask_price_cents, status)
select
  md5('backstack:' || c.local_part)::uuid,
  b.id,
  c.condition::public.copy_condition,
  c.notes,
  c.ask_price_cents,
  'open'
from (values
  -- staged 3-way
  ('ada.chen',       'morrison-boyd-organic-chemistry-3',                  'good',     'Spine cracked, all pages attached. Pencil notes in ch. 4-7.',  2200),
  ('bo.mensah',      'axler-linear-algebra-done-right-4',                  'like_new', 'Bought it, dropped the course in week two.',                    4500),
  ('cy.okafor',      'mankiw-principles-of-economics-9',                   'fair',     'Water damage along the bottom edge. Text is legible.',          1500),
  -- staged 4-way
  ('dee.laurent',    'campbell-biology-12',                                'good',     'Highlighting through the genetics unit.',                       6500),
  ('eli.novak',      'griffiths-introduction-to-electrodynamics-4',        'like_new', 'Solutions to ch. 1-3 worked in a separate notebook, included.', 5500),
  ('fern.abbott',    'norton-anthology-american-literature-b-9',           'good',     'Cover corner bent. No writing inside.',                         2800),
  ('gus.iversen',    'stewart-calculus-early-transcendentals-8',           'fair',     'Loose front cover, taped. Complete.',                           3000),
  -- staged direct swap
  ('hana.suzuki',    'rudin-principles-of-mathematical-analysis-3',        'good',     'Hardcover, previous owner initialled the flyleaf.',             5000),
  ('ike.brennan',    'sipser-introduction-to-the-theory-of-computation-3', 'like_new', 'Read once for CS 340.',                                         6000),
  -- staged edition-tolerant swap
  ('kira.osei',      'openstax-university-physics-volume-1-1',             'good',     'Print-on-demand copy of the 1st edition. Bound, not spiral.',   1200),
  ('jun.park',       'taylor-classical-mechanics-1',                       'like_new', 'Barely opened.',                                                7000),
  -- the strict-edition near miss: lena wants the 9th, mo has the 8th
  ('mo.hassan',      'stewart-calculus-early-transcendentals-8',           'good',     'Standard 8th edition, no access code.',                         3200),
  -- nia has outbound edges but no return path within four hops, so her want
  -- can only ever resolve as a purchase
  ('nia.walsh',      'giddens-introduction-to-sociology-12',               'fair',     'Reading assignments underlined in pen.',                        1100),
  ('omar.diallo',    'hull-options-futures-and-other-derivatives-11',      'good',     'Clean copy, no access code.',                                   4500),
  -- second, unstaged 3-way falls out of these three shelves
  ('pia.lindqvist',  'atkins-physical-chemistry-11',                       'good',     'Bookplate on inside cover.',                                    5200),
  ('quinn.reyes',    'lehninger-principles-of-biochemistry-8',             'like_new', 'Never used, wrong section.',                                    8000),
  ('ravi.sundaram',  'cormen-introduction-to-algorithms-4',                'good',     'Hardcover. Sticker residue on spine.',                          5500),
  -- everybody else
  ('ada.chen',       'plato-republic-2',                                   'fair',     'Marginalia throughout, mostly arguing with Thrasymachus.',       600),
  ('bo.mensah',      'myers-psychology-13',                                'good',     'No access code.',                                               4000),
  ('cy.okafor',      'foner-give-me-liberty-7',                            'good',     'Volume 1 only.',                                                2600),
  ('dee.laurent',    'hacker-a-writers-reference-10',                      'like_new', 'Spiral bound, unmarked.',                                       1800),
  ('eli.novak',      'openstax-university-physics-volume-1-2',             'new',      'Printed at the campus copy shop, never opened.',                1600),
  ('fern.abbott',    'diaz-the-brief-wondrous-life-of-oscar-wao-1',        'good',     'Paperback, creased spine.',                                      700),
  ('gus.iversen',    'tanenbaum-computer-networks-6',                      'good',     'A few dog-eared pages.',                                        4200),
  ('hana.suzuki',    'spivak-calculus-4',                                  'like_new', 'Hardcover, unmarked.',                                          6500),
  ('ike.brennan',    'silberschatz-operating-system-concepts-10',          'good',     'The dinosaur book. Cover scuffed.',                             4800),
  ('jun.park',       'serway-physics-for-scientists-and-engineers-10',     'fair',     'Chapters 1-20 only, second volume lost.',                       2000),
  ('kira.osei',      'sakurai-modern-quantum-mechanics-3',                 'like_new', 'Graduate copy, bought by mistake.',                             7500),
  ('lena.ortiz',     'varian-intermediate-microeconomics-9',               'good',     'Workbook not included.',                                        3800),
  ('mo.hassan',      'ross-a-first-course-in-probability-10',              'good',     'Solutions manual pages torn out.',                              3400),
  ('omar.diallo',    'brealey-principles-of-corporate-finance-14',         'like_new', 'Loose-leaf, in a binder.',                                      6000),
  ('pia.lindqvist',  'zumdahl-chemical-principles-8',                      'fair',     'Lab section highlighted heavily.',                              1900),
  ('quinn.reyes',    'guyton-hall-textbook-of-medical-physiology-14',      'good',     'Tabbed for the MCAT.',                                          5000),
  ('ravi.sundaram',  'skiena-the-algorithm-design-manual-3',               'like_new', 'Read for interview prep, still tight.',                         3600),
  ('sara.mbeki',     'alberts-molecular-biology-of-the-cell-7',            'good',     'Heavy. Collect in person only.',                                7200),
  ('sara.mbeki',     'griffiths-introduction-to-genetic-analysis-12',      'fair',     'Ex-library copy, stamps on the edges.',                         2100),
  ('tomas.vega',     'tignor-worlds-together-worlds-apart-6',              'good',     'Volume 2. Some underlining.',                                   2900),
  ('tomas.vega',     'rawls-a-theory-of-justice-2',                        'like_new', 'Read for a seminar, no marks.',                                 2400),
  ('uma.krishnan',   'gray-anatomy-for-students-4',                        'good',     'Plates intact, no missing pages.',                              5800),
  ('uma.krishnan',   'purves-neuroscience-6',                              'like_new', 'Bought two by accident.',                                       6800),
  ('viv.arnold',     'norton-anthology-english-literature-a-10',           'good',     'Thumb-indexed, light pencil.',                                  3300),
  ('viv.arnold',     'riverside-shakespeare-complete-works-2',             'fair',     'Cover detached from the block. Everything readable.',           1700),
  ('wes.duplantis',  'halliday-resnick-fundamentals-of-physics-11',        'good',     'Extended edition.',                                             4400),
  ('wes.duplantis',  'strogatz-nonlinear-dynamics-and-chaos-2',            'like_new', 'Excellent condition.',                                          5600),
  ('xochitl.rivera', 'macionis-society-the-basics-15',                     'fair',     'Someone highlighted every third sentence.',                     1300),
  ('xochitl.rivera', 'blackburn-think-1',                                  'good',     'Paperback.',                                                     900),
  ('yara.haddad',    'wooldridge-introductory-econometrics-7',             'good',     'Data disc missing, files are online anyway.',                   4600),
  ('yara.haddad',    'casella-berger-statistical-inference-2',             'like_new', 'Graduate text, used one term.',                                 7800),
  ('ada.chen',       'brown-chemistry-the-central-science-14',             'fair',     'Loose-leaf, hole punches torn on 30 or so pages.',              1400),
  ('bo.mensah',      'mcmurry-organic-chemistry-9',                        'good',     'Study guide included.',                                         5400),
  ('cy.okafor',      'krugman-international-economics-11',                 'good',     'Clean.',                                                        4900),
  ('dee.laurent',    'sadava-life-the-science-of-biology-12',              'fair',     'Front cover taped along the hinge.',                            2300),
  ('eli.novak',      'hoffman-kunze-linear-algebra-2',                     'good',     'Old Prentice-Hall printing.',                                   2700),
  ('fern.abbott',    'kant-critique-of-pure-reason-1',                     'good',     'Cambridge edition. Sticky notes left in.',                      3100),
  ('gus.iversen',    'russell-norvig-artificial-intelligence-4',           'like_new', 'Hardcover, read the first four chapters.',                      8500),
  ('hana.suzuki',    'strunk-white-the-elements-of-style-4',               'good',     'Pocket paperback.',                                              400),
  ('ike.brennan',    'mishkin-economics-of-money-banking-12',              'fair',     'Corner chewed, dog. Text unaffected.',                          2000),
  ('jun.park',       'kotler-principles-of-marketing-18',                  'good',     'No access code.',                                               4300),
  ('kira.osei',      'horngren-cost-accounting-17',                        'good',     'Clean copy.',                                                   5100),
  ('lena.ortiz',     'hobsbawm-the-age-of-extremes-1',                     'good',     'Paperback, sun-faded spine.',                                    800),
  ('mo.hassan',      'kandel-principles-of-neural-science-6',              'good',     'Enormous. Bring a bag.',                                        9000),
  ('nia.walsh',      'myers-psychology-13',                                'fair',     'Cover art rubbed off.',                                         1600),
  ('omar.diallo',    'macionis-society-the-basics-15',                     'good',     'Unmarked.',                                                     2500),
  ('pia.lindqvist',  'campbell-biology-12',                                'fair',     'Well travelled. Binding holding.',                              3500),
  ('quinn.reyes',    'gray-anatomy-for-students-4',                        'fair',     'Coffee ring on the cover.',                                     3900),
  ('ravi.sundaram',  'sipser-introduction-to-the-theory-of-computation-3', 'fair',     'International edition, same pagination.',                       2800),
  ('sara.mbeki',     'lehninger-principles-of-biochemistry-8',             'good',     'Bought used, already had notes in it.',                         5900),
  ('tomas.vega',     'foner-give-me-liberty-7',                            'like_new', 'Volume 2, unopened.',                                           4100),
  ('uma.krishnan',   'guyton-hall-textbook-of-medical-physiology-14',      'like_new', 'Current edition, no marks.',                                    7600),
  ('viv.arnold',     'diaz-the-brief-wondrous-life-of-oscar-wao-1',        'like_new', 'Read once.',                                                    1000),
  ('wes.duplantis',  'taylor-classical-mechanics-1',                       'fair',     'Solutions written in the margins in pen.',                      3700),
  ('xochitl.rivera', 'plato-republic-2',                                   'good',     'Hackett edition.',                                               700),
  ('yara.haddad',    'varian-intermediate-microeconomics-9',               'fair',     'Older printing, page numbers differ slightly.',                 1200)
) as c(local_part, canonical_key, condition, notes, ask_price_cents)
join public.books b on b.canonical_key = c.canonical_key;

-- --- wants (the WANTS side of every profile) --------------------------------
insert into public.wants (user_id, canonical_key, priority, edition_strict, note)
select
  md5('backstack:' || w.local_part)::uuid,
  w.canonical_key,
  w.priority,
  w.edition_strict,
  w.note
from (values
  -- staged 3-way: ada -> bo -> cy -> ada
  ('ada.chen',       'mankiw-principles-of-economics-9',                   1, false, 'ECON 101, section 3. Need it before the first problem set.'),
  ('bo.mensah',      'morrison-boyd-organic-chemistry-3',                  1, false, 'The old Morrison and Boyd specifically. The professor teaches from it.'),
  ('cy.okafor',      'axler-linear-algebra-done-right-4',                  2, false, 'MATH 214 next term.'),
  -- staged 4-way: dee -> eli -> fern -> gus -> dee
  ('dee.laurent',    'stewart-calculus-early-transcendentals-8',           2, false, 'Either printing is fine, the problems are what matter.'),
  ('eli.novak',      'campbell-biology-12',                                1, false, 'Retaking BIOL 111.'),
  ('fern.abbott',    'griffiths-introduction-to-electrodynamics-4',        1, false, 'PHYS 331, starts in three weeks.'),
  ('gus.iversen',    'norton-anthology-american-literature-b-9',           3, false, 'ENGL 210. Volume B only.'),
  -- staged direct swap
  ('hana.suzuki',    'sipser-introduction-to-the-theory-of-computation-3', 1, false, 'CS 340.'),
  ('ike.brennan',    'rudin-principles-of-mathematical-analysis-3',        1, false, 'MATH 351. Willing to trade for it.'),
  -- staged edition-tolerant swap: kira has the 1st ed, jun will take either
  ('jun.park',       'openstax-university-physics-volume-1-2',             2, false, 'PHYS 121. Any printing, it is open access.'),
  ('kira.osei',      'taylor-classical-mechanics-1',                       1, false, 'PHYS 311.'),
  -- the strict want that must not match mo.hassan's 8th edition
  ('lena.ortiz',     'stewart-calculus-early-transcendentals-9',           1, true,  'Must be the 9th. The problem numbers changed and homework is assigned by number.'),
  -- cash-only: nia holds nothing anyone wants
  ('nia.walsh',      'hull-options-futures-and-other-derivatives-11',      2, false, 'FIN 420.'),
  -- second, unstaged 3-way: pia -> quinn -> ravi is NOT it; these three make
  -- their own loop through biochem, algorithms and physical chemistry
  ('pia.lindqvist',  'lehninger-principles-of-biochemistry-8',             1, false, 'BIOC 301.'),
  ('quinn.reyes',    'cormen-introduction-to-algorithms-4',                2, false, 'CS 310, taking it as an elective.'),
  ('ravi.sundaram',  'atkins-physical-chemistry-11',                       3, false, 'CHEM 331, might drop it.'),
  -- everybody else
  ('ada.chen',       'hacker-a-writers-reference-10',                      4, false, 'WRIT 101, required for everyone.'),
  ('bo.mensah',      'silberschatz-operating-system-concepts-10',          3, false, 'CS 350.'),
  ('cy.okafor',      'wooldridge-introductory-econometrics-7',             2, false, 'ECON 320.'),
  ('dee.laurent',    'alberts-molecular-biology-of-the-cell-7',            3, false, 'BIOL 320, reference copy.'),
  ('eli.novak',      'sakurai-modern-quantum-mechanics-3',                 4, false, 'Auditing PHYS 521.'),
  ('fern.abbott',    'norton-anthology-english-literature-a-10',           2, false, 'ENGL 220.'),
  ('gus.iversen',    'skiena-the-algorithm-design-manual-3',               4, false, 'For interviews, not for a class.'),
  ('hana.suzuki',    'strogatz-nonlinear-dynamics-and-chaos-2',            3, false, 'MATH 372.'),
  ('ike.brennan',    'russell-norvig-artificial-intelligence-4',           2, false, 'CS 470.'),
  ('jun.park',       'halliday-resnick-fundamentals-of-physics-11',        4, false, 'Backup reference for PHYS 121.'),
  ('kira.osei',      'strogatz-nonlinear-dynamics-and-chaos-2',            3, false, 'MATH 372, taking it with a friend.'),
  ('lena.ortiz',     'krugman-international-economics-11',                 3, false, 'ECON 340.'),
  ('mo.hassan',      'casella-berger-statistical-inference-2',             2, false, 'STAT 411.'),
  ('mo.hassan',      'purves-neuroscience-6',                              4, false, 'NSCI 301, still deciding.'),
  ('omar.diallo',    'horngren-cost-accounting-17',                        2, false, 'ACCT 310.'),
  ('pia.lindqvist',  'brown-chemistry-the-central-science-14',             4, false, 'Reference for the CHEM 101 sections I tutor.'),
  ('quinn.reyes',    'gray-anatomy-for-students-4',                        1, false, 'ANAT 210. Mine is ruined.'),
  ('ravi.sundaram',  'tanenbaum-computer-networks-6',                      2, false, 'CS 360.'),
  ('sara.mbeki',     'campbell-biology-12',                                3, false, 'Lending it to my sister.'),
  ('sara.mbeki',     'purves-neuroscience-6',                              2, false, 'NSCI 301.'),
  ('tomas.vega',     'kant-critique-of-pure-reason-1',                     2, false, 'PHIL 320.'),
  ('tomas.vega',     'hobsbawm-the-age-of-extremes-1',                     4, false, 'HIST 340 reading list.'),
  ('uma.krishnan',   'kandel-principles-of-neural-science-6',              1, false, 'NSCI 501.'),
  ('uma.krishnan',   'lehninger-principles-of-biochemistry-8',             3, false, 'BIOC 301, prereq I skipped.'),
  ('viv.arnold',     'riverside-shakespeare-complete-works-2',             5, false, 'Want a second copy to mark up.'),
  ('viv.arnold',     'diaz-the-brief-wondrous-life-of-oscar-wao-1',        4, false, 'ENGL 245.'),
  ('wes.duplantis',  'serway-physics-for-scientists-and-engineers-10',     2, false, 'PHYS 122.'),
  ('wes.duplantis',  'spivak-calculus-4',                                  3, false, 'MATH 131.'),
  ('xochitl.rivera', 'myers-psychology-13',                                2, false, 'PSYC 101.'),
  ('xochitl.rivera', 'giddens-introduction-to-sociology-12',               3, false, 'SOC 101, the Giddens one.'),
  ('yara.haddad',    'mishkin-economics-of-money-banking-12',              2, false, 'ECON 330.'),
  ('yara.haddad',    'ross-a-first-course-in-probability-10',              3, false, 'STAT 201.'),
  ('ada.chen',       'zumdahl-chemical-principles-8',                      5, false, 'Only if it is cheap.'),
  ('bo.mensah',      'blackburn-think-1',                                  5, false, 'PHIL 101, elective.'),
  ('cy.okafor',      'macionis-society-the-basics-15',                     4, false, 'SOC 101.'),
  ('dee.laurent',    'griffiths-introduction-to-genetic-analysis-12',      2, false, 'BIOL 340.'),
  ('eli.novak',      'hoffman-kunze-linear-algebra-2',                     5, false, 'Curiosity, not a class.'),
  ('fern.abbott',    'plato-republic-2',                                   3, false, 'PHIL 101.'),
  ('gus.iversen',    'foner-give-me-liberty-7',                            3, false, 'HIST 111.'),
  ('hana.suzuki',    'casella-berger-statistical-inference-2',             4, false, 'STAT 411 next year.'),
  ('ike.brennan',    'strunk-white-the-elements-of-style-4',               5, false, 'My advisor keeps mentioning it.'),
  ('jun.park',       'brealey-principles-of-corporate-finance-14',         4, false, 'FIN 310.'),
  ('omar.diallo',    'kotler-principles-of-marketing-18',                  3, false, 'MKTG 201.'),
  ('viv.arnold',     'tignor-worlds-together-worlds-apart-6',              4, false, 'HIST 101.'),
  ('xochitl.rivera', 'rawls-a-theory-of-justice-2',                        3, false, 'PHIL 340.')
) as w(local_part, canonical_key, priority, edition_strict, note);

-- --- a worked canonicalization cache entry ----------------------------------
-- One real row so the cache is not an empty table at demo time. The hash is
-- sha256 of the normalized_input, matching what the pipeline computes.
insert into public.cache_canonicalization (
  input_hash, raw_input, normalized_input, result, canonical_key, model, source, hits
)
select
  encode(sha256(convert_to('orgo 3rd ed morrison boyd, spine cracked', 'utf8')), 'hex'),
  'orgo 3rd ed morrison boyd, spine cracked',
  'orgo 3rd ed morrison boyd, spine cracked',
  jsonb_build_object(
    'title', 'Organic Chemistry',
    'authors', jsonb_build_array('Robert T. Morrison', 'Robert N. Boyd'),
    'edition', '3rd ed.',
    'edition_number', 3,
    'subject_tags', jsonb_build_array('chemistry', 'organic-chemistry', 'upper-division'),
    'condition_guess', 'good',
    'canonical_key', 'morrison-boyd-organic-chemistry-3',
    'work_key', 'morrison-boyd-organic-chemistry'
  ),
  'morrison-boyd-organic-chemistry-3',
  'gemini-2.5-flash-lite',
  'gemini',
  1;

-- --- materialize the match table --------------------------------------------
select public.materialize_matches(500);

-- --- one conversation on the staged 3-way -----------------------------------
insert into public.messages (match_id, sender_id, body)
select
  m.id,
  md5('backstack:ada.chen')::uuid,
  'Three-way works for me. I can leave the Morrison and Boyd at the Ellery Hall desk Thursday after 2.'
from public.matches m
where m.leg_count = 3
  and (
    select array_agg(distinct l.giver_id order by l.giver_id)
      from public.match_legs l
     where l.match_id = m.id
  ) = (
    select array_agg(distinct u order by u)
      from unnest(array[
        md5('backstack:ada.chen')::uuid,
        md5('backstack:bo.mensah')::uuid,
        md5('backstack:cy.okafor')::uuid
      ]) as u
  );

commit;
