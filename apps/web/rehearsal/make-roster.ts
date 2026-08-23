/** Build the CSV an organizer would export from a Google Sheet. 73 rows → 80 total. */
import { writeFileSync } from "node:fs";

const FIRST = [
  "Aditya",
  "Rohit",
  "Kunal",
  "Nikhil",
  "Sameer",
  "Harsh",
  "Yash",
  "Pranav",
  "Siddharth",
  "Varun",
  "Akash",
  "Rahul",
  "Mayank",
  "Tushar",
  "Gaurav",
  "Nitin",
  "Ankit",
  "Abhishek",
  "Rajat",
  "Saurabh",
  "Vishal",
  "Manav",
  "Devendra",
  "Ritesh",
  "Chirag",
  "Parth",
  "Jatin",
  "Hardik",
  "Kartik",
  "Naveen",
  "Sagar",
  "Amol",
  "Ninad",
  "Prathamesh",
  "Swapnil",
  "Omkar",
  "Aniket",
  "Rushikesh",
  "Sarthak",
  "Atharva",
  "Faizan",
  "Zaid",
  "Arbaz",
  "Salman",
  "Irfan",
  "Danish",
  "Rehan",
  "Sufiyan",
  "Aamir",
  "Junaid",
  "Joel",
  "Ryan",
  "Clyde",
  "Nolan",
  "Glenn",
  "Ashwin",
  "Karthik",
  "Vignesh",
  "Naveen",
  "Balaji",
  "Jaspreet",
  "Manpreet",
  "Harjeet",
  "Gurpreet",
  "Simran",
  "Tanmay",
  "Shubham",
  "Kaustubh",
  "Yogesh",
  "Piyush",
  "Rupesh",
  "Dhiraj",
  "Ganesh",
];
const LAST = [
  "Sharma",
  "Patil",
  "Deshpande",
  "Joshi",
  "Kulkarni",
  "Naik",
  "Shetty",
  "Rao",
  "Iyer",
  "Menon",
  "Khan",
  "Shaikh",
  "Ansari",
  "Qureshi",
  "Pathan",
  "Fernandes",
  "D'Souza",
  "Pereira",
  "Rodrigues",
  "Gomes",
  "Singh",
  "Chauhan",
  "Rathod",
  "Jadhav",
  "Pawar",
  "Gaikwad",
  "More",
  "Sawant",
  "Bhosale",
  "Thakur",
  "Gupta",
  "Agarwal",
  "Bansal",
  "Mittal",
  "Jain",
  "Shah",
  "Mehta",
  "Trivedi",
  "Vyas",
  "Pandya",
  "Reddy",
  "Nair",
  "Pillai",
  "Kurup",
  "Warrier",
  "Das",
  "Ghosh",
  "Banerjee",
  "Mukherjee",
  "Chatterjee",
  "Yadav",
  "Verma",
  "Mishra",
  "Tiwari",
  "Dubey",
  "Pandey",
  "Shukla",
  "Saxena",
  "Chaturvedi",
  "Bhatt",
  "Solanki",
  "Parmar",
  "Chavda",
  "Vaghela",
  "Zala",
  "Kadam",
  "Salunkhe",
  "Mane",
  "Shinde",
  "Ghorpade",
  "Wagh",
  "Lokhande",
  "Sonawane",
];
const ROLES = ["batter", "bowler", "all_rounder", "wicket_keeper"];
const BANDS = ["A", "B", "C"];
const BAT = [
  "Right Hand Batsman",
  "Left Hand Batsman",
  "Right Hand Opener",
  "Left Hand Middle Order",
];
const BOWL = ["Right Arm Fast", "Right Arm Medium", "Off-Break", "Leg-Break", "Left Arm Orthodox"];

const rows: string[] = [
  "name,phone,role,base_price_band,date_of_birth,batting_style,bowling_style",
];
for (let i = 0; i < 73; i++) {
  const phone = `88020${String(10000 + i).slice(-5)}`; // 8802010000…8802010072
  const name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
  const role = ROLES[i % 4] as string;
  const band = BANDS[i % 3] as string;
  const year = 1992 + (i % 14);
  const dob = `${year}-${String((i % 12) + 1).padStart(2, "0")}-${String((i % 27) + 1).padStart(2, "0")}`;
  const bat = BAT[i % BAT.length];
  const bowl = role === "batter" ? "" : BOWL[i % BOWL.length];
  rows.push(`${name},${phone},${role},${band},${dob},${bat},${bowl}`);
}
writeFileSync("rehearsal/artifacts/roster-73.csv", rows.join("\n") + "\n");

// A deliberately dirty file — what a Google Sheet export actually looks like.
const dirty =
  [
    "name,phone,role,base_price_band,date_of_birth,batting_style,bowling_style",
    "Clean Row One,8803000001,batter,A,1995-01-01,Right Hand Batsman,",
    "Bad Phone Row,12345,bowler,B,,,", // invalid phone
    "No Role Row,8803000003,,C,,,", // missing role
    "Clean Row Two,8803000004,bowler,B,1996-02-02,,Right Arm Fast",
    "Dup In File,8803000001,keeper,A,,,", // dup phone + bad role token
    ",8803000006,batter,A,,,", // missing name
    "Clean Row Three,8803000007,all_rounder,C,,,",
  ].join("\n") + "\n";
writeFileSync("rehearsal/artifacts/roster-dirty.csv", dirty);
console.log("wrote roster-73.csv (73 rows) and roster-dirty.csv (7 rows, 4 bad)");
