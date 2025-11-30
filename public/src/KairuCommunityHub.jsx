import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, arrayUnion } from 'firebase/firestore';
import { ChevronDown, Send, User, MessageSquare, Heart, CornerUpLeft, MessageCircle } from 'lucide-react';

// --- Global Variables (Provided by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Utility to safely format timestamps
const formatTimestamp = (timestamp) => {
    if (!timestamp) return "Just now";
    
    // Check if it's a Firestore Timestamp object or a number/string
    let date;
    if (timestamp.toDate) {
        date = timestamp.toDate();
    } else {
        // Attempt to parse if it's a raw number or string (e.g., from local state before Firestore confirmation)
        date = new Date(timestamp);
    }

    if (isNaN(date)) return "Unknown time";

    const now = new Date();
    const diffInMinutes = Math.floor((now - date) / (1000 * 60));
    
    if (diffInMinutes < 1) return "Just now";
    if (diffInMinutes < 60) return `${diffInMinutes} minute${diffInMinutes !== 1 ? 's' : ''} ago`;
    if (diffInMinutes < 1440) { // Less than 24 hours
        return `${Math.floor(diffInMinutes / 60)} hour${Math.floor(diffInMinutes / 60) !== 1 ? 's' : ''} ago`;
    }
    
    // Default format: Month Day, Year
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

// Utility to handle text formatting (e.g., highlighting user IDs)
const formatTextContent = (text, allUsers) => {
    if (!text) return null;
    const parts = [];
    // Regex to find @mentions or text segments
    const regex = /(\@([a-zA-Z0-9]+))|([^\@]+)/g;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match[2]) { // It's an @mention
            const mentionedId = match[2];
            const isKnownUser = allUsers.some(u => u.startsWith(mentionedId)); // Simple check if the mention matches the start of any User ID
            const style = isKnownUser ? 'text-blue-500 font-semibold' : 'text-gray-400';
            parts.push(<span key={match.index} className={style}>{match[0]}</span>);
        } else if (match[3]) { // Regular text segment
            parts.push(<span key={match.index}>{match[0]}</span>);
        }
    }
    return parts;
};


// --- FIREBASE INITIALIZATION AND CONTEXT (or Hooks) ---
const useFirebase = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [userCount, setUserCount] = useState(0);

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestoreDb = getFirestore(app);
            const firebaseAuth = getAuth(app);
            setDb(firestoreDb);
            setAuth(firebaseAuth);

            // 1. Authenticate user
            const authenticate = async (authInstance) => {
                if (initialAuthToken) {
                    await signInWithCustomToken(authInstance, initialAuthToken);
                } else {
                    await signInAnonymously(authInstance);
                }
            };
            authenticate(firebaseAuth);

            // 2. Set up auth state listener
            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
                const currentId = user?.uid || null;
                setUserId(currentId);
                setIsAuthReady(true);
            });

            // 3. Set up user count listener (using a simple 'users' collection for presence tracking)
            if (firestoreDb) {
                const usersColRef = collection(firestoreDb, `artifacts/${appId}/public/data/users`);
                const unsubscribeUsers = onSnapshot(usersColRef, (snapshot) => {
                    setUserCount(snapshot.size);
                });
                return () => {
                    unsubscribeAuth();
                    unsubscribeUsers();
                };
            }
        } catch (error) {
            console.error("Firebase Initialization or Auth Failed:", error);
        }
        return () => {};
    }, []);

    return { db, auth, userId, isAuthReady, userCount };
};

// --- POSTS COMPONENT (Primary Data Fetcher) ---
const usePosts = (db, userId, isAuthReady) => {
    const [posts, setPosts] = useState([]);
    const [allUserIds, setAllUserIds] = useState([]);

    useEffect(() => {
        if (!isAuthReady || !db || !userId) return;

        try {
            const postsColRef = collection(db, `artifacts/${appId}/public/data/posts`);
            // Sort by timestamp (newest first)
            const postsQuery = query(postsColRef, orderBy('timestamp', 'desc'));

            const unsubscribePosts = onSnapshot(postsQuery, (snapshot) => {
                const fetchedPosts = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }));
                setPosts(fetchedPosts);

                // Collect unique user IDs from posts and comments
                const uniqueIds = new Set();
                fetchedPosts.forEach(post => {
                    if (post.userId) uniqueIds.add(post.userId);
                    post.comments?.forEach(comment => {
                        if (comment.userId) uniqueIds.add(comment.userId);
                    });
                });
                // Update the list of known user IDs for mention checking
                setAllUserIds(Array.from(uniqueIds));
            }, (error) => {
                console.error("Error fetching posts:", error);
            });

            return () => unsubscribePosts();
        } catch (error) {
            console.error("Firestore Setup Error:", error);
        }
    }, [db, userId, isAuthReady]);

    return { posts, allUserIds };
};

// --- PostItem Component ---
const PostItem = ({ post, userId, db, allUserIds }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [commentText, setCommentText] = useState('');
    const commentInputRef = useRef(null);

    const handleLike = async () => {
        if (!db || !userId) return;
        const postRef = doc(db, `artifacts/${appId}/public/data/posts`, post.id);

        try {
            const currentLikes = post.likes || [];
            let newLikes;

            if (currentLikes.includes(userId)) {
                // Unlike: Remove userId
                newLikes = currentLikes.filter(id => id !== userId);
            } else {
                // Like: Add userId
                newLikes = [...currentLikes, userId];
            }

            await updateDoc(postRef, {
                likes: newLikes
            });
        } catch (error) {
            console.error("Error updating likes:", error);
        }
    };

    const handleAddComment = async (e) => {
        e.preventDefault();
        if (!db || !userId || !commentText.trim()) return;

        try {
            const postRef = doc(db, `artifacts/${appId}/public/data/posts`, post.id);

            const newComment = {
                userId,
                text: commentText.trim(),
                timestamp: serverTimestamp(),
            };

            await updateDoc(postRef, {
                comments: arrayUnion(newComment)
            });

            setCommentText('');
            setIsExpanded(true); // Keep comments visible after posting
        } catch (error) {
            console.error("Error adding comment:", error);
        }
    };

    const userLiked = post.likes?.includes(userId);
    const displayedComments = (post.comments || []).slice().sort((a, b) => a.timestamp?.seconds - b.timestamp?.seconds); // Sort oldest first
    const visibleComments = isExpanded ? displayedComments : displayedComments.slice(-2); // Show last 2 when collapsed

    return (
        <div className="bg-white p-4 shadow-md rounded-xl mb-6 border border-gray-100">
            {/* Post Header */}
            <div className="flex items-start mb-3">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold mr-3">
                    <User size={16} />
                </div>
                <div>
                    <p className="text-gray-800 font-semibold truncate max-w-xs sm:max-w-none">
                        {post.userId}
                    </p>
                    <p className="text-xs text-gray-500">
                        {formatTimestamp(post.timestamp)}
                    </p>
                </div>
            </div>

            {/* Post Content */}
            <p className="text-gray-700 whitespace-pre-wrap mb-4">
                {formatTextContent(post.content, allUserIds)}
            </p>

            {/* Actions */}
            <div className="flex justify-between items-center text-sm text-gray-600 border-t border-b border-gray-100 py-2">
                <div className="flex space-x-4">
                    {/* Like Button */}
                    <button
                        onClick={handleLike}
                        className={`flex items-center transition-colors ${userLiked ? 'text-red-500' : 'text-gray-500 hover:text-red-500'}`}
                    >
                        <Heart size={18} fill={userLiked ? 'currentColor' : 'none'} className="mr-1" />
                        <span className="font-medium">{post.likes?.length || 0}</span>
                    </button>

                    {/* Comment Button */}
                    <button
                        onClick={() => {
                            setIsExpanded(!isExpanded);
                            if (!isExpanded && commentInputRef.current) {
                                setTimeout(() => commentInputRef.current.focus(), 100);
                            }
                        }}
                        className="flex items-center text-gray-500 hover:text-blue-500 transition-colors"
                    >
                        <MessageCircle size={18} className="mr-1" />
                        <span className="font-medium">{post.comments?.length || 0}</span>
                    </button>
                </div>
            </div>

            {/* Comments Section */}
            {(post.comments?.length > 0) && (
                <div className="mt-4">
                    {/* Show button to expand if there are hidden comments */}
                    {!isExpanded && displayedComments.length > visibleComments.length && (
                        <button
                            onClick={() => setIsExpanded(true)}
                            className="flex items-center text-blue-500 text-sm mb-2 hover:underline"
                        >
                            <ChevronDown size={14} className="mr-1" />
                            View all {displayedComments.length} comments
                        </button>
                    )}

                    {/* Visible Comments */}
                    <div className="space-y-3">
                        {visibleComments.map((comment, index) => (
                            <div key={index} className="bg-gray-50 p-3 rounded-lg text-sm">
                                <div className="flex items-center mb-1">
                                    <span className="font-semibold text-gray-800 mr-2 truncate max-w-[calc(100%-80px)]">
                                        {comment.userId}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                        {formatTimestamp(comment.timestamp)}
                                    </span>
                                </div>
                                <p className="text-gray-700 whitespace-pre-wrap">
                                    {formatTextContent(comment.text, allUserIds)}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Collapse button */}
                    {isExpanded && (
                        <button
                            onClick={() => setIsExpanded(false)}
                            className="flex items-center text-blue-500 text-sm mt-3 hover:underline"
                        >
                            <ChevronDown size={14} className="mr-1 transform rotate-180" />
                            Show less
                        </button>
                    )}
                </div>
            )}


            {/* Comment Input */}
            <form onSubmit={handleAddComment} className="mt-4 flex space-x-2">
                <input
                    ref={commentInputRef}
                    type="text"
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Write a comment..."
                    className="flex-grow p-3 border border-gray-300 rounded-full focus:ring-blue-500 focus:border-blue-500 text-sm"
                    disabled={!userId}
                />
                <button
                    type="submit"
                    className="bg-blue-500 text-white p-3 rounded-full hover:bg-blue-600 transition-colors disabled:bg-gray-400"
                    disabled={!commentText.trim() || !userId}
                    aria-label="Send Comment"
                >
                    <Send size={18} />
                </button>
            </form>
        </div>
    );
};

// --- NewPost Component ---
const NewPost = ({ db, userId }) => {
    const [content, setContent] = useState('');
    const [isPosting, setIsPosting] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!content.trim() || !db || !userId) return;

        setIsPosting(true);
        try {
            const postsColRef = collection(db, `artifacts/${appId}/public/data/posts`);
            await addDoc(postsColRef, {
                userId,
                content: content.trim(),
                timestamp: serverTimestamp(),
                likes: [],
                comments: []
            });

            setContent('');
        } catch (error) {
            console.error("Error creating post:", error);
        } finally {
            setIsPosting(false);
        }
    };

    return (
        <div className="bg-white p-4 shadow-md rounded-xl mb-6 border border-gray-100">
            <h2 className="text-xl font-bold text-gray-800 mb-3">Share Your Wildlife Story</h2>
            <form onSubmit={handleSubmit}>
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="What amazing wildlife encounter did you have today? Use @[username] to mention fellow explorers!"
                    rows="4"
                    className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 mb-3 resize-none"
                    disabled={isPosting || !userId}
                />
                <button
                    type="submit"
                    className="w-full bg-green-500 text-white py-2 rounded-lg font-semibold hover:bg-green-600 transition-colors disabled:bg-gray-400 flex items-center justify-center"
                    disabled={!content.trim() || isPosting || !userId}
                >
                    {isPosting ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Posting...
                        </>
                    ) : (
                        <>
                            <Send size={18} className="mr-2" />
                            Post to the Community
                        </>
                    )}
                </button>
                {!userId && (
                    <p className="text-sm text-red-500 mt-2 text-center">Please wait for authentication to complete before posting.</p>
                )}
            </form>
        </div>
    );
};


// --- MAIN APP COMPONENT ---
export default function App() {
    const { db, userId, isAuthReady, userCount } = useFirebase();
    const { posts, allUserIds } = usePosts(db, userId, isAuthReady);

    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-50">
                <div className="text-center p-8 bg-white shadow-xl rounded-xl">
                    <svg className="animate-spin mx-auto h-12 w-12 text-blue-600 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p className="text-gray-700 font-semibold">Connecting to the Wildlife Network...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 font-inter">
            <header className="bg-white shadow-sm border-b border-gray-100 sticky top-0 z-10">
                <div className="max-w-xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex justify-between items-center">
                    <h1 className="text-2xl font-extrabold text-green-600 tracking-tight">
                        Explore with Kairu
                    </h1>
                    <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-600 flex items-center">
                            <User size={16} className="mr-1 text-green-500" />
                            <span className="font-medium">{userCount} Active</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="max-w-xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
                {/* User ID and Instructions Card */}
                <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl mb-6 shadow-sm">
                    <h2 className="font-bold text-blue-800 flex items-center">
                        <User size={20} className="mr-2" /> Your Explorer ID
                    </h2>
                    <p className="text-sm text-blue-700 mt-1 break-all">
                        {userId}
                    </p>
                    <p className="text-xs text-blue-600 mt-2">
                        Use this ID to mention other explorers in comments (e.g., @{userId.substring(0, 8)}...)
                    </p>
                </div>

                {/* New Post Form */}
                <NewPost db={db} userId={userId} />

                {/* Feed */}
                <div className="mt-8">
                    <h2 className="text-2xl font-bold text-gray-800 mb-4">Community Feed ({posts.length} posts)</h2>
                    {posts.length === 0 ? (
                        <div className="text-center py-10 text-gray-500">
                            Be the first to share a post!
                        </div>
                    ) : (
                        posts.map(post => (
                            <PostItem
                                key={post.id}
                                post={post}
                                userId={userId}
                                db={db}
                                allUserIds={allUserIds}
                            />
                        ))
                    )}
                </div>
            </main>

            <footer className="max-w-xl mx-auto px-4 py-6 sm:px-6 lg:px-8 text-center text-xs text-gray-500">
                &copy; {new Date().getFullYear()} Kairu Community Hub. Powered by Firebase.
            </footer>
        </div>
    );
}

