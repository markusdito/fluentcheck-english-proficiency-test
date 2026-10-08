/**
 * CEFR B1 Speaking Test Sets A–F (PRD §3.3, FR-6.4), transcribed from the
 * source spec "CEFR B1 SPEAKING ASSESSMENT". Each slot keeps the spec's
 * prompt audio script (`audioScript`, produced as `seed-assets/audio/<set>-<slot>.mp3`)
 * and its onscreen content. Part 3 always asks for ONE option (PRD §3.1),
 * although the spec's screen mock-ups still say "Choose TWO".
 *
 * Option icons are Lucide icon names rendered to
 * `seed-assets/icons/<icon>.png`.
 */

export type SeedSlot = "PART_1A" | "PART_1B" | "PART_2" | "PART_3" | "PART_4";

export interface SeedQuestion {
  category: SeedSlot;
  preparationSeconds: number;
  recordingSeconds: number;
  audioScript: string;
  tasks: string[];
  cueCard?: { topic: string; points: [string, string, string] };
  options?: { title: string; bullets: [string, string]; icon: string }[];
}

export interface SeedTestSet {
  code: string;
  questions: SeedQuestion[];
}

const PART_2_TIMING = { preparationSeconds: 60, recordingSeconds: 90 };
const PART_3_TIMING = { preparationSeconds: 60, recordingSeconds: 90 };

function part1(category: "PART_1A" | "PART_1B", audioScript: string, task: string): SeedQuestion {
  return { category, preparationSeconds: 10, recordingSeconds: 45, audioScript, tasks: [task] };
}

function part2(subject: string, topic: string, points: [string, string, string]): SeedQuestion {
  return {
    category: "PART_2",
    ...PART_2_TIMING,
    audioScript: `You will now give a short talk about ${subject}. You have 60 seconds to prepare your response and 90 seconds to speak into your microphone. You may begin preparing now.`,
    tasks: [`Give a short talk about ${subject}. You may make brief notes on paper while you prepare.`],
    cueCard: { topic, points },
  };
}

function part3(audioScript: string, task: string, options: SeedQuestion["options"]): SeedQuestion {
  return { category: "PART_3", ...PART_3_TIMING, audioScript, tasks: [task], options };
}

function part4(audioScript: string, task: string): SeedQuestion {
  return { category: "PART_4", preparationSeconds: 15, recordingSeconds: 60, audioScript, tasks: [task] };
}

export const TEST_SETS: SeedTestSet[] = [
  {
    code: "A",
    questions: [
      part1(
        "PART_1A",
        "As you prepare to graduate from high school, what are your main plans for next year?",
        "Task 1A: Describe your main plans for next year after high school graduation.",
      ),
      part1(
        "PART_1B",
        "How do you think learning English in high school will help you in your future career or university studies?",
        "Task 1B: Explain how English will help in your future studies or career.",
      ),
      part2("community action", "Community Action for High School Graduates", [
        "Identify one local community issue you care about (e.g., waste, youth education, public health).",
        "Explain why it is important for young people in Indonesia to help solve this issue.",
        "Describe one practical activity high school graduates could organize.",
      ]),
      part3(
        "Look at the four project options on your screen. Select the ONE option you think is most valuable for high school graduates and explain why. You have 60 seconds to prepare and 90 seconds to speak.",
        "Task 3: Choose the ONE graduation project you think is most valuable for high school graduates and explain why.",
        [
          { title: "Social Service Week", bullets: ["Volunteer at local shelters", "Teach children or distribute food"], icon: "hand-heart" },
          { title: "Cultural & Eco-Tourism", bullets: ["2-day regional study tour", "Beach or river cleanup activity"], icon: "map" },
          { title: "Digital & AI Workshop", bullets: ["Hands-on digital media creation", "Responsible AI tool usage"], icon: "cpu" },
          { title: "Alumni Career Day", bullets: ["Guest speaker sessions", "Mentorship and career advice"], icon: "briefcase" },
        ],
      ),
      part4(
        "Some people believe practical vocational skills are more important for high school graduates today than a university degree. What is your opinion?",
        "Task 4: Express your opinion on whether practical vocational skills are more important than a university degree for today's high school graduates.",
      ),
    ],
  },
  {
    code: "B",
    questions: [
      part1(
        "PART_1A",
        "What is your favorite digital app or tool for learning, and how do you use it every day?",
        "Task 1A: Describe your favorite digital learning app and how you use it daily.",
      ),
      part1(
        "PART_1B",
        "How do you and your family try to reduce waste or save energy at home?",
        "Task 1B: Explain how you and your family save energy or reduce waste at home.",
      ),
      part2("preparing for future workplace changes", "Preparing for Future Workplace Changes", [
        "Identify one job or career field you are interested in pursuing.",
        "Describe how technology or automation might change this career field.",
        "Explain what skills young people need to adapt to these changes.",
      ]),
      part3(
        "Look at the four eco-friendly school initiatives on your screen. Select the ONE option you think is most effective for high schools and explain why. You have 60 seconds to prepare and 90 seconds to speak.",
        "Task 3: Choose the ONE eco-friendly school initiative you think is most effective and explain why.",
        [
          { title: "Campus Waste Sorting", bullets: ["Install organic & plastic bins", "Weekly student recycling contests"], icon: "recycle" },
          { title: "Solar Energy Campaign", bullets: ["Student-led awareness workshops", "Install small solar charger units"], icon: "sun" },
          { title: "School Garden Project", bullets: ["Plant vegetables and local herbs", "Sell produce to support school"], icon: "sprout" },
          { title: "Digital Paperless Policy", bullets: ["Replace printed worksheets", "Digital submissions in class"], icon: "tablet" },
        ],
      ),
      part4(
        "Some people argue that artificial intelligence tools should be banned in high school assignments because they encourage cheating. What is your opinion?",
        "Task 4: Express your opinion on whether AI tools should be banned in high school assignments.",
      ),
    ],
  },
  {
    code: "C",
    questions: [
      part1(
        "PART_1A",
        "Describe a memorable place in Indonesia you have visited and why you enjoyed it.",
        "Task 1A: Describe a memorable place in Indonesia you visited and why you enjoyed it.",
      ),
      part1(
        "PART_1B",
        "Why is it important for young people to learn about cultures from other countries?",
        "Task 1B: Explain why young people should learn about foreign cultures.",
      ),
      part2("promoting local tourism and culture", "Promoting Local Tourism & Culture", [
        "Choose one traditional Indonesian cultural event, food, or landmark.",
        "Explain why this cultural aspect is unique and attractive to visitors.",
        "Suggest how high school students could promote it using social media.",
      ]),
      part3(
        "Look at the four international student exchange proposals on your screen. Select the ONE option you think is most practical and valuable for high school students and explain why. You have 60 seconds to prepare and 90 seconds to speak.",
        "Task 3: Choose the ONE student exchange proposal you think is most practical and valuable and explain why.",
        [
          { title: "Cultural Homestay Trip", bullets: ["1-week stay with host families", "Attend local school classes"], icon: "house" },
          { title: "Online Pen-Pal Project", bullets: ["Weekly video calls", "Joint online presentations"], icon: "video" },
          { title: "Global Culinary Festival", bullets: ["Cook traditional recipes", "Exchange recipes with partner schools"], icon: "chef-hat" },
          { title: "Joint Arts Exhibition", bullets: ["Shared online art galleries", "Traditional music showcases"], icon: "palette" },
        ],
      ),
      part4(
        "Some people think that learning a foreign language is no longer necessary because automatic translation devices can instantly translate spoken words. What is your opinion?",
        "Task 4: Express your opinion on whether automatic translation technology makes learning foreign languages unnecessary.",
      ),
    ],
  },
  {
    code: "D",
    questions: [
      part1(
        "PART_1A",
        "What study environment or routine helps you focus best when preparing for examinations?",
        "Task 1A: Describe your preferred study environment and routine for exams.",
      ),
      part1(
        "PART_1B",
        "How has participating in school clubs or extracurricular activities helped you develop outside the classroom?",
        "Task 1B: Explain how school clubs or activities have helped your personal development.",
      ),
      part2("essential practical life skills", "Essential Practical Life Skills for High School Students", [
        "Identify one practical life skill not taught in school (e.g., financial management, cooking, time management).",
        "Explain why this skill is vital for graduates entering university or work.",
        "Suggest how high schools could integrate this skill into the curriculum.",
      ]),
      part3(
        "Look at the four learning space modernization options on your screen. Select the ONE option you think is most valuable for high school students and explain why. You have 60 seconds to prepare and 90 seconds to speak.",
        "Task 3: Choose the ONE learning space modernization you think is most valuable and explain why.",
        [
          { title: "Open Collaborative Hub", bullets: ["Flexible seating & whiteboards", "Group study space for projects"], icon: "users" },
          { title: "Silent Individual Pods", bullets: ["Sound-dampened focus booths", "High-speed internet for research"], icon: "headphones" },
          { title: "Digital Media Production", bullets: ["Podcast studio & green screen", "Audio/video editing equipment"], icon: "mic" },
          { title: "Outdoor Learning Garden", bullets: ["Shaded seating with wifi power", "Environmentally integrated space"], icon: "trees" },
        ],
      ),
      part4(
        "Some people believe that traditional physical textbooks should be completely replaced by digital eBooks in high schools. What is your opinion?",
        "Task 4: Express your opinion on whether digital eBooks should completely replace physical textbooks in high schools.",
      ),
    ],
  },
  {
    code: "E",
    questions: [
      part1(
        "PART_1A",
        "What physical activity or sport do you enjoy doing to stay active, and how often do you participate in it?",
        "Task 1A: Describe your favorite sport or exercise and how often you do it.",
      ),
      part1(
        "PART_1B",
        "How do you balance your school responsibilities with your personal rest and relaxation time?",
        "Task 1B: Explain how you manage stress and balance schoolwork with relaxation.",
      ),
      part2("promoting healthy habits among teenagers", "Promoting Healthy Habits Among Teenagers", [
        "Identify one unhealthy habit common among teenagers today (e.g., late sleeping, excessive screen time, poor diet).",
        "Explain the negative impacts of this habit on physical or mental health.",
        "Suggest two practical steps young people can take to build healthier habits.",
      ]),
      part3(
        "Look at the four Student Wellness Week options on your screen. Select the ONE option you think is most beneficial for students and explain why. You have 60 seconds to prepare and 90 seconds to speak.",
        "Task 3: Choose the ONE Student Wellness Week option you think is most beneficial and explain why.",
        [
          { title: "Healthy Cooking Class", bullets: ["Practical meal prep workshops", "Focus on affordable nutrition"], icon: "salad" },
          { title: "Campus Sports Tournament", bullets: ["Inter-class fun matches", "Team-building activities"], icon: "trophy" },
          { title: "Mindfulness & Sleep Talk", bullets: ["Expert guidance on stress control", "Healthy sleep hygiene advice"], icon: "moon" },
          { title: "Digital Detox Day", bullets: ["Screen-free group games", "Outdoor socialization activities"], icon: "monitor-off" },
        ],
      ),
      part4(
        "Some people argue that high schools should start classes at a later time in the morning to allow teenagers to get more sleep. What is your opinion?",
        "Task 4: Express your opinion on whether high schools should start classes later in the morning.",
      ),
    ],
  },
  {
    code: "F",
    questions: [
      part1(
        "PART_1A",
        "What type of online content, for example podcasts, educational videos, or social media blogs, do you enjoy consuming in your free time?",
        "Task 1A: Describe the online content you enjoy consuming in your free time.",
      ),
      part1(
        "PART_1B",
        "Describe a creative activity or hobby you like to do, such as music, drawing, writing, or photography.",
        "Task 1B: Describe a creative hobby or activity you enjoy.",
      ),
      part2("digital content creation by young people", "Digital Content Creation by Young People", [
        "Identify a popular form of digital content creation among youth today.",
        "Explain why many teenagers are interested in becoming content creators.",
        "Discuss one potential benefit and one risk associated with this trend.",
      ]),
      part3(
        "Look at the four Youth Creative Festival options on your screen. Select the ONE option you think is most engaging for high school students and explain why. You have 60 seconds to prepare and 90 seconds to speak.",
        "Task 3: Choose the ONE Youth Creative Festival option you think is most engaging and explain why.",
        [
          { title: "Short Film Festival", bullets: ["Student-made mini documentaries", "Screenings in school auditorium"], icon: "film" },
          { title: "Live Music & Performing", bullets: ["Acoustic performances & drama", "Outdoor stage presentation"], icon: "music" },
          { title: "Digital Art & Photography", bullets: ["Interactive digital showcase", "Online public voting competition"], icon: "camera" },
          { title: "Creative Writing Workshop", bullets: ["Student zines & poetry slams", "Guest author sharing session"], icon: "pen-line" },
        ],
      ),
      part4(
        "Some people believe social media has a mostly negative impact on teenagers' social lives. What is your opinion?",
        "Task 4: Express your opinion on whether social media has a mostly negative impact on teenagers' social lives.",
      ),
    ],
  },
];
