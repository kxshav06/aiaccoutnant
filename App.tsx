import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, 
  PlusCircle, 
  Wallet, 
  Target, 
  PieChart as PieChartIcon, 
  MessageSquare, 
  LogOut, 
  LogIn,
  TrendingUp,
  TrendingDown,
  ChevronRight,
  Trash2,
  X,
  Send,
  Loader2,
  Menu
} from 'lucide-react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  orderBy, 
  limit,
  Timestamp,
  setDoc,
  getDoc,
  updateDoc
} from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth, db, signIn, logOut, OperationType, handleFirestoreError } from './firebase';
import { cn } from './lib/utils';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  LineChart,
  Line
} from 'recharts';
import { format, startOfMonth, endOfMonth, subMonths, isWithinInterval } from 'date-fns';
import { GoogleGenAI } from '@google/genai';
import Markdown from 'react-markdown';

// --- Types ---
interface Transaction {
  id: string;
  uid: string;
  amount: number;
  type: 'income' | 'expense';
  category: string;
  description: string;
  date: string;
  createdAt: string;
}

interface Budget {
  id: string;
  uid: string;
  category: string;
  limit: number;
  month: string;
}

interface Goal {
  id: string;
  uid: string;
  title: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
}

// --- Constants ---
const CATEGORIES = [
  'Food', 'Rent', 'Utilities', 'Transport', 'Entertainment', 
  'Shopping', 'Health', 'Salary', 'Investment', 'Other'
];

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#8dd1e1', '#a4de6c', '#d0ed57'];

// --- Components ---

const SidebarItem = ({ icon: Icon, label, active, onClick }: { icon: any, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 w-full px-4 py-3 rounded-xl transition-all duration-200",
      active 
        ? "bg-black text-white shadow-lg" 
        : "text-gray-500 hover:bg-gray-100 hover:text-black"
    )}
  >
    <Icon size={20} />
    <span className="font-medium">{label}</span>
  </button>
);

const StatCard = ({ title, amount, type, icon: Icon }: { title: string, amount: number, type: 'income' | 'expense' | 'neutral', icon: any }) => (
  <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm">
    <div className="flex justify-between items-start mb-4">
      <div className={cn(
        "p-3 rounded-2xl",
        type === 'income' ? "bg-green-50 text-green-600" : 
        type === 'expense' ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
      )}>
        <Icon size={24} />
      </div>
      <span className={cn(
        "text-xs font-bold px-2 py-1 rounded-full",
        type === 'income' ? "bg-green-100 text-green-700" : 
        type === 'expense' ? "bg-red-100 text-red-700" : "bg-blue-100 text-blue-700"
      )}>
        {type === 'income' ? '+12%' : type === 'expense' ? '-5%' : 'Stable'}
      </span>
    </div>
    <h3 className="text-gray-500 text-sm font-medium mb-1">{title}</h3>
    <p className="text-2xl font-bold text-black">₹{amount.toLocaleString()}</p>
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isAddingTransaction, setIsAddingTransaction] = useState(false);
  const [isAddingBudget, setIsAddingBudget] = useState(false);
  const [isAddingGoal, setIsAddingGoal] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Form states
  const [newTx, setNewTx] = useState({
    amount: '',
    type: 'expense' as 'income' | 'expense',
    category: 'Food',
    description: '',
    date: format(new Date(), 'yyyy-MM-dd')
  });

  const [newBudget, setNewBudget] = useState({
    category: 'Food',
    limit: '',
    month: format(new Date(), 'yyyy-MM')
  });

  const [newGoal, setNewGoal] = useState({
    title: '',
    targetAmount: '',
    currentAmount: '0',
    deadline: format(new Date(), 'yyyy-MM-dd')
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (loading) setShowTroubleshoot(true);
    }, 5000);

    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      clearTimeout(timer);
      if (u) {
        // Create user profile if not exists
        const userRef = doc(db, 'users', u.uid);
        getDoc(userRef).then((docSnap) => {
          if (!docSnap.exists()) {
            setDoc(userRef, {
              uid: u.uid,
              displayName: u.displayName,
              email: u.email,
              currency: 'INR',
              monthlyIncome: 0,
              createdAt: new Date().toISOString()
            });
          }
        });
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user) return;

    const txQuery = query(
      collection(db, 'transactions'),
      where('uid', '==', user.uid),
      orderBy('date', 'desc')
    );

    const budgetQuery = query(
      collection(db, 'budgets'),
      where('uid', '==', user.uid)
    );

    const goalQuery = query(
      collection(db, 'goals'),
      where('uid', '==', user.uid)
    );

    const unsubTx = onSnapshot(txQuery, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'transactions'));

    const unsubBudgets = onSnapshot(budgetQuery, (snapshot) => {
      setBudgets(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Budget)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'budgets'));

    const unsubGoals = onSnapshot(goalQuery, (snapshot) => {
      setGoals(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Goal)));
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'goals'));

    return () => {
      unsubTx();
      unsubBudgets();
      unsubGoals();
    };
  }, [user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newTx.amount) return;

    try {
      await addDoc(collection(db, 'transactions'), {
        uid: user.uid,
        amount: parseFloat(newTx.amount),
        type: newTx.type,
        category: newTx.category,
        description: newTx.description,
        date: newTx.date,
        createdAt: new Date().toISOString()
      });
      setIsAddingTransaction(false);
      setNewTx({
        amount: '',
        type: 'expense',
        category: 'Food',
        description: '',
        date: format(new Date(), 'yyyy-MM-dd')
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'transactions');
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'transactions', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'transactions');
    }
  };

  const handleAddBudget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newBudget.limit) return;

    try {
      await addDoc(collection(db, 'budgets'), {
        uid: user.uid,
        category: newBudget.category,
        limit: parseFloat(newBudget.limit),
        month: newBudget.month
      });
      setIsAddingBudget(false);
      setNewBudget({
        category: 'Food',
        limit: '',
        month: format(new Date(), 'yyyy-MM')
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'budgets');
    }
  };

  const handleDeleteBudget = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'budgets', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'budgets');
    }
  };

  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !newGoal.targetAmount || !newGoal.title) return;

    try {
      await addDoc(collection(db, 'goals'), {
        uid: user.uid,
        title: newGoal.title,
        targetAmount: parseFloat(newGoal.targetAmount),
        currentAmount: parseFloat(newGoal.currentAmount || '0'),
        deadline: newGoal.deadline
      });
      setIsAddingGoal(false);
      setNewGoal({
        title: '',
        targetAmount: '',
        currentAmount: '0',
        deadline: format(new Date(), 'yyyy-MM-dd')
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'goals');
    }
  };

  const handleDeleteGoal = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'goals', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'goals');
    }
  };

  const handleUpdateGoalProgress = async (id: string, current: number, increment: number) => {
    try {
      await updateDoc(doc(db, 'goals', id), {
        currentAmount: current + increment
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'goals');
    }
  };

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatLoading) return;

    const userMsg = chatInput.trim();
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      // Standard Vite way to access variables
      const apiKey = (import.meta as any).env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      
      if (!apiKey || apiKey === 'undefined' || apiKey === 'YOUR_API_KEY_HERE') {
        throw new Error('Gemini API Key is missing. Please add VITE_GEMINI_API_KEY to your Vercel Environment Variables and REDEPLOY.');
      }
      
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [{ role: 'user', parts: [{ text: userMsg }] }],
        config: {
          systemInstruction: `You are AI Accountant, an advanced AI Accountant and Financial Advisor. 
          Current User Context:
          - Transactions: ${JSON.stringify(transactions.slice(0, 20))}
          - Budgets: ${JSON.stringify(budgets)}
          - Goals: ${JSON.stringify(goals)}
          
          Provide professional, supportive, and data-driven financial advice. All currency values are in Indian Rupees (₹). Use tables or lists when helpful.`
        }
      });

      const aiText = response.text || "I'm sorry, I couldn't process that.";
      setChatMessages(prev => [...prev, { role: 'model', text: aiText }]);
    } catch (error) {
      console.error('Chat error:', error);
      setChatMessages(prev => [...prev, { role: 'model', text: "Sorry, I'm having trouble connecting right now." }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Calculations
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const balance = totalIncome - totalExpense;

  const expenseRatio = totalIncome > 0 ? (totalExpense / totalIncome) : 0;
  let budgetScoreEmoji = '⚪';
  let budgetScoreText = 'No data';
  let budgetScoreColor = 'text-gray-400';

  if (totalIncome > 0) {
    if (expenseRatio < 0.5) {
      budgetScoreEmoji = '🟢';
      budgetScoreText = 'Excellent';
      budgetScoreColor = 'text-green-600';
    } else if (expenseRatio < 0.8) {
      budgetScoreEmoji = '🟡';
      budgetScoreText = 'Warning';
      budgetScoreColor = 'text-yellow-600';
    } else {
      budgetScoreEmoji = '🔴';
      budgetScoreText = 'Danger';
      budgetScoreColor = 'text-red-600';
    }
  }

  const categoryData = CATEGORIES.map(cat => {
    const amount = transactions
      .filter(t => t.category === cat && t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    return { name: cat, value: amount };
  }).filter(d => d.value > 0);

  const monthlyData = Array.from({ length: 6 }).map((_, i) => {
    const d = subMonths(new Date(), 5 - i);
    const monthStr = format(d, 'MMM');
    const income = transactions
      .filter(t => t.type === 'income' && format(new Date(t.date), 'MMM') === monthStr)
      .reduce((sum, t) => sum + t.amount, 0);
    const expense = transactions
      .filter(t => t.type === 'expense' && format(new Date(t.date), 'MMM') === monthStr)
      .reduce((sum, t) => sum + t.amount, 0);
    return { name: monthStr, income, expense };
  });

  if (loading) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-50 p-6">
        <Loader2 className="animate-spin text-black mb-6" size={48} />
        <p className="text-gray-500 font-medium">Initializing AI Accountant...</p>
        
        {showTroubleshoot && (
          <div className="mt-10 p-6 bg-white rounded-3xl border border-red-100 shadow-xl max-w-md text-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-red-600 font-bold mb-2">Taking longer than usual?</h3>
            <p className="text-sm text-gray-500 mb-6">
              This usually means your Firebase configuration or Authorized Domains are not set up correctly for this URL.
            </p>
            <div className="space-y-3">
              <a 
                href="https://console.firebase.google.com/" 
                target="_blank" 
                className="block w-full bg-black text-white py-3 rounded-xl font-bold text-sm"
              >
                Go to Firebase Console
              </a>
              <button 
                onClick={() => window.location.reload()} 
                className="block w-full bg-gray-100 text-black py-3 rounded-xl font-bold text-sm"
              >
                Refresh Page
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen w-full flex flex-col items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full bg-white p-10 rounded-[40px] shadow-xl text-center border border-gray-100">
          <div className="w-20 h-20 bg-black rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-2xl rotate-3">
            <Wallet className="text-white" size={40} />
          </div>
          <h1 className="text-4xl font-black text-black mb-4 tracking-tight">AI Accountant</h1>
          <p className="text-gray-500 mb-10 leading-relaxed">
            Your personal AI accountant and financial strategist. Track, analyze, and grow your wealth.
          </p>
          <button
            onClick={signIn}
            className="w-full bg-black text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-3 hover:scale-[1.02] transition-transform shadow-lg active:scale-95"
          >
            <LogIn size={20} />
            Continue with Google
          </button>
          <p className="mt-8 text-xs text-gray-400 uppercase tracking-widest font-bold">
            Secure • Private • AI-Powered
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F9FA] flex">
      {/* Sidebar - Desktop */}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-gray-100 p-6 transition-transform duration-300 lg:relative lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="flex items-center gap-3 mb-12 px-2">
          <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center shadow-lg">
            <Wallet className="text-white" size={20} />
          </div>
          <span className="text-xl font-black tracking-tight">AI Accountant</span>
          <button className="lg:hidden ml-auto" onClick={() => setIsSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        <nav className="space-y-2">
          <SidebarItem icon={LayoutDashboard} label="Dashboard" active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} />
          <SidebarItem icon={PlusCircle} label="Transactions" active={activeTab === 'transactions'} onClick={() => setActiveTab('transactions')} />
          <SidebarItem icon={PieChartIcon} label="Budgeting" active={activeTab === 'budgeting'} onClick={() => setActiveTab('budgeting')} />
          <SidebarItem icon={Target} label="Goals" active={activeTab === 'goals'} onClick={() => setActiveTab('goals')} />
          <SidebarItem icon={MessageSquare} label="AI Advisor" active={activeTab === 'chat'} onClick={() => setActiveTab('chat')} />
        </nav>

        <div className="absolute bottom-8 left-6 right-6">
          <div className="bg-gray-50 p-4 rounded-2xl mb-4 flex items-center gap-3">
            <img src={user.photoURL || ''} alt="" className="w-10 h-10 rounded-full border-2 border-white shadow-sm" />
            <div className="overflow-hidden">
              <p className="text-sm font-bold truncate">{user.displayName}</p>
              <p className="text-xs text-gray-500 truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={logOut}
            className="flex items-center gap-3 w-full px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl transition-colors font-medium"
          >
            <LogOut size={20} />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Header */}
        <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 p-6 flex items-center justify-between sticky top-0 z-40">
          <div className="flex items-center gap-4">
            <button className="lg:hidden p-2 hover:bg-gray-100 rounded-lg" onClick={() => setIsSidebarOpen(true)}>
              <Menu size={24} />
            </button>
            <h2 className="text-2xl font-bold capitalize">{activeTab}</h2>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                if (activeTab === 'budgeting') setIsAddingBudget(true);
                else if (activeTab === 'goals') setIsAddingGoal(true);
                else setIsAddingTransaction(true);
              }}
              className="bg-black text-white px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 hover:scale-105 transition-transform shadow-md"
            >
              <PlusCircle size={18} />
              {activeTab === 'budgeting' ? 'Set Budget' : activeTab === 'goals' ? 'New Goal' : 'Add New'}
            </button>
          </div>
        </header>

        {/* Scrollable Area */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-10">
          {activeTab === 'dashboard' && (
            <div className="max-w-6xl mx-auto space-y-10">
              {/* Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <StatCard title="Total Balance" amount={balance} type="neutral" icon={Wallet} />
                <StatCard title="Monthly Income" amount={totalIncome} type="income" icon={TrendingUp} />
                <StatCard title="Monthly Expenses" amount={totalExpense} type="expense" icon={TrendingDown} />
                <div className="bg-white p-6 rounded-3xl border border-gray-100 shadow-sm flex flex-col justify-center items-center text-center">
                  <div className="text-4xl mb-2">{budgetScoreEmoji}</div>
                  <h3 className="text-gray-500 text-sm font-medium mb-1">Budget Health</h3>
                  <p className={cn("text-xl font-bold", budgetScoreColor)}>{budgetScoreText}</p>
                </div>
              </div>

              {/* Charts Row */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm">
                  <h3 className="text-lg font-bold mb-6">Cash Flow</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={monthlyData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#999', fontSize: 12}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fill: '#999', fontSize: 12}} />
                        <Tooltip 
                          contentStyle={{borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)'}}
                          cursor={{fill: '#f8f9fa'}}
                        />
                        <Bar dataKey="income" fill="#000" radius={[4, 4, 0, 0]} barSize={20} />
                        <Bar dataKey="expense" fill="#E5E7EB" radius={[4, 4, 0, 0]} barSize={20} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm">
                  <h3 className="text-lg font-bold mb-6">Spending by Category</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          innerRadius={80}
                          outerRadius={110}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {categoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* Recent Transactions */}
              <div className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm">
                <div className="flex justify-between items-center mb-8">
                  <h3 className="text-lg font-bold">Recent Transactions</h3>
                  <button onClick={() => setActiveTab('transactions')} className="text-sm font-bold text-gray-400 hover:text-black transition-colors">View All</button>
                </div>
                <div className="space-y-4">
                  {transactions.slice(0, 5).map(tx => (
                    <div key={tx.id} className="flex items-center justify-between p-4 hover:bg-gray-50 rounded-2xl transition-colors group">
                      <div className="flex items-center gap-4">
                        <div className={cn(
                          "w-12 h-12 rounded-xl flex items-center justify-center font-bold",
                          tx.type === 'income' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                        )}>
                          {tx.category[0]}
                        </div>
                        <div>
                          <p className="font-bold text-black">{tx.description || tx.category}</p>
                          <p className="text-xs text-gray-400">{format(new Date(tx.date), 'MMM dd, yyyy')}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className={cn(
                          "font-bold",
                          tx.type === 'income' ? "text-green-600" : "text-black"
                        )}>
                          {tx.type === 'income' ? '+' : '-'}₹{tx.amount.toLocaleString()}
                        </p>
                        <p className="text-[10px] uppercase tracking-widest font-bold text-gray-300">{tx.category}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="max-w-4xl mx-auto">
              <div className="bg-white rounded-[32px] border border-gray-100 shadow-sm overflow-hidden">
                <div className="p-8 border-b border-gray-50 flex justify-between items-center">
                  <h3 className="text-lg font-bold">All Transactions</h3>
                  <div className="flex gap-2">
                    <select className="bg-gray-50 border-none rounded-xl px-4 py-2 text-sm font-medium focus:ring-2 ring-black">
                      <option>All Types</option>
                      <option>Income</option>
                      <option>Expense</option>
                    </select>
                  </div>
                </div>
                <div className="divide-y divide-gray-50">
                  {transactions.map(tx => (
                    <div key={tx.id} className="flex items-center justify-between p-6 hover:bg-gray-50 transition-colors group">
                      <div className="flex items-center gap-5">
                        <div className={cn(
                          "w-14 h-14 rounded-2xl flex items-center justify-center text-xl",
                          tx.type === 'income' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                        )}>
                          {tx.category[0]}
                        </div>
                        <div>
                          <p className="font-bold text-lg">{tx.description || tx.category}</p>
                          <div className="flex items-center gap-3 mt-1">
                            <span className="text-xs font-bold text-gray-400 uppercase tracking-tighter">{tx.category}</span>
                            <span className="w-1 h-1 bg-gray-200 rounded-full"></span>
                            <span className="text-xs text-gray-400">{format(new Date(tx.date), 'MMMM dd, yyyy')}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <p className={cn(
                          "text-xl font-black",
                          tx.type === 'income' ? "text-green-600" : "text-black"
                        )}>
                          {tx.type === 'income' ? '+' : '-'}₹{tx.amount.toLocaleString()}
                        </p>
                        <button 
                          onClick={() => handleDeleteTransaction(tx.id)}
                          className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {transactions.length === 0 && (
                    <div className="p-20 text-center">
                      <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <Wallet className="text-gray-200" size={32} />
                      </div>
                      <p className="text-gray-400 font-medium">No transactions found. Start by adding one!</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'chat' && (
            <div className="max-w-4xl mx-auto h-full flex flex-col">
              <div className="flex-1 bg-white rounded-[40px] border border-gray-100 shadow-sm flex flex-col overflow-hidden">
                <div className="p-6 border-b border-gray-50 flex items-center gap-4">
                  <div className="w-12 h-12 bg-black rounded-2xl flex items-center justify-center shadow-lg">
                    <MessageSquare className="text-white" size={24} />
                  </div>
                  <div>
                    <h3 className="font-bold">AI Accountant Advisor</h3>
                    <p className="text-xs text-green-500 font-bold flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                      Online & Ready
                    </p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {chatMessages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center p-10">
                      <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-6">
                        <TrendingUp className="text-gray-200" size={32} />
                      </div>
                      <h4 className="text-xl font-bold mb-2">Ask me anything about your finances</h4>
                      <p className="text-gray-400 max-w-sm">
                        "How much did I spend on food this month?" or "Can I afford a ₹50,000 purchase?"
                      </p>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn(
                      "flex",
                      msg.role === 'user' ? "justify-end" : "justify-start"
                    )}>
                      <div className={cn(
                        "max-w-[80%] p-5 rounded-3xl text-sm leading-relaxed",
                        msg.role === 'user' 
                          ? "bg-black text-white rounded-tr-none shadow-lg" 
                          : "bg-gray-50 text-gray-800 rounded-tl-none border border-gray-100"
                      )}>
                        <div className="markdown-body prose prose-sm max-w-none prose-headings:text-inherit prose-p:text-inherit">
                          <Markdown>
                            {msg.text}
                          </Markdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-gray-50 p-5 rounded-3xl rounded-tl-none border border-gray-100 flex gap-2">
                        <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce"></span>
                        <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                        <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <form onSubmit={handleChat} className="p-6 border-t border-gray-50 bg-gray-50/50">
                  <div className="relative">
                    <input
                      type="text"
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Ask FinBot..."
                      className="w-full bg-white border border-gray-200 rounded-2xl px-6 py-4 pr-16 focus:ring-2 ring-black outline-none shadow-sm transition-all"
                    />
                    <button 
                      type="submit"
                      disabled={!chatInput.trim() || isChatLoading}
                      className="absolute right-2 top-2 bottom-2 bg-black text-white w-12 rounded-xl flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-50 disabled:scale-100"
                    >
                      <Send size={20} />
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {activeTab === 'budgeting' && (
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {budgets.map(budget => {
                  const spent = transactions
                    .filter(t => t.type === 'expense' && t.category === budget.category && t.date.startsWith(budget.month))
                    .reduce((sum, t) => sum + t.amount, 0);
                  const percent = Math.min(Math.round((spent / budget.limit) * 100), 100);
                  
                  return (
                    <div key={budget.id} className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm relative group">
                      <button 
                        onClick={() => handleDeleteBudget(budget.id)}
                        className="absolute top-6 right-6 p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h4 className="text-xl font-black">{budget.category}</h4>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">{budget.month}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-400">Limit: ₹{budget.limit.toLocaleString()}</p>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <div className="flex justify-between text-sm font-bold">
                          <span>Spent: ₹{spent.toLocaleString()}</span>
                          <span className={cn(percent > 90 ? "text-red-500" : "text-black")}>{percent}%</span>
                        </div>
                        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              percent > 100 ? "bg-red-500" : percent > 80 ? "bg-yellow-500" : "bg-black"
                            )}
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {budgets.length === 0 && (
                <div className="text-center py-20 bg-white rounded-[40px] border border-dashed border-gray-200">
                  <PieChartIcon className="mx-auto text-gray-200 mb-4" size={48} />
                  <p className="text-gray-400 font-medium">No budgets set for this month.</p>
                  <button 
                    onClick={() => setIsAddingBudget(true)}
                    className="mt-4 text-black font-bold hover:underline"
                  >
                    Create your first budget
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'goals' && (
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {goals.map(goal => {
                  const percent = Math.min(Math.round((goal.currentAmount / goal.targetAmount) * 100), 100);
                  
                  return (
                    <div key={goal.id} className="bg-white p-8 rounded-[32px] border border-gray-100 shadow-sm relative group">
                      <button 
                        onClick={() => handleDeleteGoal(goal.id)}
                        className="absolute top-6 right-6 p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={18} />
                      </button>
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h4 className="text-xl font-black">{goal.title}</h4>
                          <p className="text-xs text-gray-400 font-bold uppercase tracking-widest">Target: ₹{goal.targetAmount.toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-gray-400 font-bold">By {format(new Date(goal.deadline), 'MMM yyyy')}</p>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        <div className="flex justify-between text-sm font-bold">
                          <span>Saved: ₹{goal.currentAmount.toLocaleString()}</span>
                          <span>{percent}%</span>
                        </div>
                        <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-black transition-all duration-500"
                            style={{ width: `${percent}%` }}
                          />
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleUpdateGoalProgress(goal.id, goal.currentAmount, 100)}
                            className="flex-1 bg-gray-50 hover:bg-gray-100 py-2 rounded-xl text-xs font-bold transition-colors"
                          >
                            +₹100
                          </button>
                          <button 
                            onClick={() => handleUpdateGoalProgress(goal.id, goal.currentAmount, 1000)}
                            className="flex-1 bg-gray-50 hover:bg-gray-100 py-2 rounded-xl text-xs font-bold transition-colors"
                          >
                            +₹1000
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              {goals.length === 0 && (
                <div className="text-center py-20 bg-white rounded-[40px] border border-dashed border-gray-200">
                  <Target className="mx-auto text-gray-200 mb-4" size={48} />
                  <p className="text-gray-400 font-medium">No financial goals yet.</p>
                  <button 
                    onClick={() => setIsAddingGoal(true)}
                    className="mt-4 text-black font-bold hover:underline"
                  >
                    Set your first goal
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Add Transaction Modal */}
      {isAddingTransaction && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsAddingTransaction(false)} />
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center">
              <h3 className="text-2xl font-black">Add Transaction</h3>
              <button onClick={() => setIsAddingTransaction(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleAddTransaction} className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setNewTx(prev => ({ ...prev, type: 'expense' }))}
                  className={cn(
                    "py-4 rounded-2xl font-bold border-2 transition-all",
                    newTx.type === 'expense' ? "border-black bg-black text-white shadow-lg" : "border-gray-100 text-gray-400 hover:border-gray-200"
                  )}
                >
                  Expense
                </button>
                <button
                  type="button"
                  onClick={() => setNewTx(prev => ({ ...prev, type: 'income' }))}
                  className={cn(
                    "py-4 rounded-2xl font-bold border-2 transition-all",
                    newTx.type === 'income' ? "border-green-500 bg-green-500 text-white shadow-lg" : "border-gray-100 text-gray-400 hover:border-gray-200"
                  )}
                >
                  Income
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Amount</label>
                  <div className="relative">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-300">₹</span>
                    <input
                      type="number"
                      required
                      value={newTx.amount}
                      onChange={(e) => setNewTx(prev => ({ ...prev, amount: e.target.value }))}
                      placeholder="0.00"
                      className="w-full bg-gray-50 border-none rounded-2xl px-12 py-5 text-3xl font-black focus:ring-2 ring-black outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Category</label>
                    <select
                      value={newTx.category}
                      onChange={(e) => setNewTx(prev => ({ ...prev, category: e.target.value }))}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none appearance-none"
                    >
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Date</label>
                    <input
                      type="date"
                      required
                      value={newTx.date}
                      onChange={(e) => setNewTx(prev => ({ ...prev, date: e.target.value }))}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Description</label>
                  <input
                    type="text"
                    value={newTx.description}
                    onChange={(e) => setNewTx(prev => ({ ...prev, description: e.target.value }))}
                    placeholder="What was this for?"
                    className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-black text-white py-5 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl active:scale-95"
              >
                Save Transaction
              </button>
            </form>
          </div>
        </div>
      )}
      {/* Add Budget Modal */}
      {isAddingBudget && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsAddingBudget(false)} />
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center">
              <h3 className="text-2xl font-black">Set Category Budget</h3>
              <button onClick={() => setIsAddingBudget(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleAddBudget} className="p-8 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Monthly Limit</label>
                  <div className="relative">
                    <span className="absolute left-6 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-300">₹</span>
                    <input
                      type="number"
                      required
                      value={newBudget.limit}
                      onChange={(e) => setNewBudget(prev => ({ ...prev, limit: e.target.value }))}
                      placeholder="0.00"
                      className="w-full bg-gray-50 border-none rounded-2xl px-12 py-5 text-3xl font-black focus:ring-2 ring-black outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Category</label>
                    <select
                      value={newBudget.category}
                      onChange={(e) => setNewBudget(prev => ({ ...prev, category: e.target.value }))}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none appearance-none"
                    >
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Month</label>
                    <input
                      type="month"
                      required
                      value={newBudget.month}
                      onChange={(e) => setNewBudget(prev => ({ ...prev, month: e.target.value }))}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-black text-white py-5 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl active:scale-95"
              >
                Set Budget
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Add Goal Modal */}
      {isAddingGoal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => setIsAddingGoal(false)} />
          <div className="bg-white w-full max-w-lg rounded-[40px] shadow-2xl relative z-10 overflow-hidden animate-in fade-in zoom-in duration-300">
            <div className="p-8 border-b border-gray-50 flex justify-between items-center">
              <h3 className="text-2xl font-black">New Financial Goal</h3>
              <button onClick={() => setIsAddingGoal(false)} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleAddGoal} className="p-8 space-y-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Goal Title</label>
                  <input
                    type="text"
                    required
                    value={newGoal.title}
                    onChange={(e) => setNewGoal(prev => ({ ...prev, title: e.target.value }))}
                    placeholder="e.g. New Car, Emergency Fund"
                    className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Target Amount</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 font-bold">₹</span>
                      <input
                        type="number"
                        required
                        value={newGoal.targetAmount}
                        onChange={(e) => setNewGoal(prev => ({ ...prev, targetAmount: e.target.value }))}
                        placeholder="0.00"
                        className="w-full bg-gray-50 border-none rounded-2xl px-10 py-4 font-bold focus:ring-2 ring-black outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Deadline</label>
                    <input
                      type="date"
                      required
                      value={newGoal.deadline}
                      onChange={(e) => setNewGoal(prev => ({ ...prev, deadline: e.target.value }))}
                      className="w-full bg-gray-50 border-none rounded-2xl px-6 py-4 font-bold focus:ring-2 ring-black outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2 block">Initial Savings (Optional)</label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 font-bold">₹</span>
                    <input
                      type="number"
                      value={newGoal.currentAmount}
                      onChange={(e) => setNewGoal(prev => ({ ...prev, currentAmount: e.target.value }))}
                      placeholder="0.00"
                      className="w-full bg-gray-50 border-none rounded-2xl px-10 py-4 font-bold focus:ring-2 ring-black outline-none"
                    />
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full bg-black text-white py-5 rounded-2xl font-bold text-lg hover:scale-[1.02] transition-transform shadow-xl active:scale-95"
              >
                Create Goal
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
